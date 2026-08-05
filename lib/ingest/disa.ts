import { prisma } from '@/lib/db'
import { readFile } from 'fs/promises'
import * as XLSX from 'xlsx'

const LOG_PREFIX = '[DISA-SYNC]'

const DCAS_URL_PREFIX =
  'https://dl.dod.cyber.mil/wp-content/uploads/cloud/xls/DCAS+Current+Authorized+CSOs+-+'
const DCAS_URL_SUFFIX = '.xlsx'
const PROBE_DAYS = 35
/** Per-probe ceiling. 36 probes x 8s worst case stays well inside the budget. */
const PROBE_TIMEOUT_MS = 5_000
/** Overall ceiling for the probe walk, independent of how many URLs remain. */
const PROBE_TOTAL_MS = 45_000
/**
 * Body download gets its own, larger budget. Probing and downloading were one
 * timeout, which meant a multi-megabyte xlsx arriving at 7.9s of an 8s budget
 * was aborted -- the timeout could kill a SUCCESS, not just a hang.
 */
const DOWNLOAD_TIMEOUT_MS = 60_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value)
    if (d) return new Date(d.y, d.m - 1, d.d)
  }
  const d = new Date(value as string)
  return isNaN(d.getTime()) ? null : d
}

function normalizeImpactLevel(raw: string): string {
  if (!raw) return 'Unknown'
  const match = raw.match(/IL(\d)/i)
  if (match) return `IL${match[1]}`
  return raw
}

function ymd(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dcasUrlForDate(date: Date): string {
  return `${DCAS_URL_PREFIX}${ymd(date)}${DCAS_URL_SUFFIX}`
}

// ---------------------------------------------------------------------------
// Mapped record
// ---------------------------------------------------------------------------
export interface MappedDcasRecord {
  csoName: string
  cspName: string
  impactLevel: string
  paDate: Date | null
  paExpiration: Date | null
  sponsorComponent: string
  conditions: string | null
}

// ---------------------------------------------------------------------------
// Workbook parser
// DCAS xlsx columns (header row skipped):
//   0 = CSP, 1 = CSO, 2 = Impact Level, 3 = Service Models,
//   4 = Auth Status, 5 = Auth Expiration
// ---------------------------------------------------------------------------
export function parseDcasWorkbook(buffer: ArrayBuffer | Buffer): MappedDcasRecord[] {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('DCAS workbook contained no sheets')

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })
  const dataRows = rows.slice(1).filter((r) => Array.isArray(r) && r.length > 0 && r[0])

  const records: MappedDcasRecord[] = []
  for (const row of dataRows) {
    const cspName = String(row[0] ?? '').trim()
    const csoName = String(row[1] ?? '').trim()
    const impactLevelRaw = String(row[2] ?? '').trim()
    const serviceModels = String(row[3] ?? '').trim()
    const authStatus = String(row[4] ?? '').trim()

    if (!cspName || !csoName) continue

    records.push({
      cspName,
      csoName,
      impactLevel: normalizeImpactLevel(impactLevelRaw),
      paDate: null,
      paExpiration: parseDate(row[5]),
      sponsorComponent: 'DISA',
      conditions: serviceModels
        ? `Service Models: ${serviceModels}${authStatus ? `. Status: ${authStatus}` : ''}`
        : authStatus || null,
    })
  }
  return records
}

// ---------------------------------------------------------------------------
// Source loaders
// ---------------------------------------------------------------------------

/**
 * Fetch the latest DCAS xlsx by probing recent dates. DISA reposts the file
 * weekly with the publish date in the filename and offers no stable alias,
 * so we walk back from today until we find a 200.
 */
/**
 * Publish date of the last xlsx we successfully found, cached in the sync log.
 *
 * Without it every run re-probes from scratch: if the newest file is 30 days
 * old, that is 30 requests to a .mil host every night, forever, to rediscover
 * something already known.
 */
export async function lastKnownDcasDate(): Promise<string | null> {
  try {
    const log = await prisma.atoSyncLog.findUnique({ where: { source: 'disa-xlsx' } })
    return log?.cursor ?? null
  } catch {
    return null
  }
}

async function rememberDcasDate(publishDate: string): Promise<void> {
  try {
    await prisma.atoSyncLog.upsert({
      where: { source: 'disa-xlsx' },
      create: { source: 'disa-xlsx', cursor: publishDate, status: 'success' },
      update: { cursor: publishDate },
    })
  } catch (err) {
    console.warn(`${LOG_PREFIX} Could not cache DCAS publish date:`, err)
  }
}

/** HEAD probe. Cheap existence check that never pulls a body. */
async function probeExists(url: string): Promise<boolean | 'unsupported'> {
  const res = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  // Some static hosts reject HEAD; fall back to GET probing for this run.
  if (res.status === 405 || res.status === 501) return 'unsupported'
  return res.ok
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function fetchLatestDcasXlsx(
  options: { daysBack?: number; startDate?: Date } = {}
): Promise<{ buffer: Buffer; url: string; publishDate: string }> {
  const start = options.startDate ?? new Date()

  // Never probe further back than a date already known to exist. A cached hit
  // three days old means at most three probes, not thirty-six.
  const cached = await lastKnownDcasDate()
  let daysBack = options.daysBack ?? PROBE_DAYS
  if (cached) {
    const cachedMs = Date.parse(`${cached}T00:00:00Z`)
    if (!Number.isNaN(cachedMs)) {
      const daysSince = Math.floor((start.getTime() - cachedMs) / 86_400_000)
      daysBack = Math.max(0, Math.min(daysBack, daysSince))
    }
  }

  const tried: string[] = []
  const probeDeadline = Date.now() + PROBE_TOTAL_MS
  let headSupported = true

  // Newest first, so a newer publication still wins over the cached one.
  for (let i = 0; i <= daysBack; i++) {
    if (Date.now() >= probeDeadline) {
      console.warn(
        `${LOG_PREFIX} Probe budget spent after ${tried.length} URLs; falling back to the cached file`
      )
      break
    }
    const probe = new Date(start)
    probe.setUTCDate(probe.getUTCDate() - i)
    const url = dcasUrlForDate(probe)
    tried.push(url)

    try {
      let found: boolean
      if (headSupported) {
        const head = await probeExists(url)
        if (head === 'unsupported') {
          headSupported = false
          found = (await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })).ok
        } else {
          found = head
        }
      } else {
        found = (await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })).ok
      }

      if (found) {
        const buffer = await download(url)
        const publishDate = ymd(probe)
        console.log(`${LOG_PREFIX} Found DCAS xlsx: ${url} (${buffer.length} bytes)`)
        await rememberDcasDate(publishDate)
        return { buffer, url, publishDate }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`${LOG_PREFIX} Probe error for ${url}: ${msg}`)
    }
  }

  // Nothing newer. If a previously-found file is known, use it rather than
  // failing the stage -- it is the same data the last successful run ingested.
  if (cached) {
    const cachedDate = new Date(`${cached}T00:00:00Z`)
    const url = dcasUrlForDate(cachedDate)
    console.log(`${LOG_PREFIX} No newer DCAS xlsx; using cached ${cached}`)
    return { buffer: await download(url), url, publishDate: cached }
  }

  throw new Error(
    `No DCAS xlsx found in the last ${daysBack} days (probed ${tried.length} URLs back from ${ymd(start)})`
  )
}

export async function fetchDcasFromUrl(url: string): Promise<{ buffer: Buffer; url: string }> {
  console.log(`${LOG_PREFIX} Fetching DCAS xlsx from ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`DCAS fetch failed: ${res.status} ${res.statusText}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, url }
}

export async function loadDcasFromFile(filePath: string): Promise<Buffer> {
  console.log(`${LOG_PREFIX} Loading DCAS xlsx from file: ${filePath}`)
  return readFile(filePath)
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface DisaSyncResult {
  added: number
  updated: number
  failed: number
  total: number
  errors: string[]
}

/**
 * Upsert DCAS records into dod_provisional_auth keyed on (cso, csp, IL) and
 * write an atoSyncLog entry. Non-destructive — records that disappear from
 * the latest xlsx are left as-is, matching the FedRAMP sync's behavior.
 */
export async function syncDisaData(records: MappedDcasRecord[]): Promise<DisaSyncResult> {
  let added = 0
  let updated = 0
  let failed = 0
  const errors: string[] = []

  console.log(`${LOG_PREFIX} Starting sync of ${records.length} DCAS records`)

  for (const record of records) {
    try {
      const existing = await prisma.dodProvisionalAuth.findUnique({
        where: {
          csoName_cspName_impactLevel: {
            csoName: record.csoName,
            cspName: record.cspName,
            impactLevel: record.impactLevel,
          },
        },
        select: { id: true },
      })

      const data = {
        csoName: record.csoName,
        cspName: record.cspName,
        impactLevel: record.impactLevel,
        paDate: record.paDate,
        paExpiration: record.paExpiration,
        sponsorComponent: record.sponsorComponent,
        conditions: record.conditions,
        source: 'disa-xlsx',
        lastSynced: new Date(),
      }

      if (existing) {
        await prisma.dodProvisionalAuth.update({ where: { id: existing.id }, data })
        updated++
      } else {
        await prisma.dodProvisionalAuth.create({ data })
        added++
      }
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Failed ${record.cspName}/${record.csoName}/${record.impactLevel}: ${msg}`)
      console.error(`${LOG_PREFIX} Upsert error:`, msg)
    }
  }

  try {
    await prisma.atoSyncLog.upsert({
      where: { source: 'disa' },
      create: {
        source: 'disa',
        lastSyncAt: new Date(),
        recordsAdded: added,
        recordsUpdated: updated,
        recordsFailed: failed,
        status: failed > 0 && added === 0 && updated === 0 ? 'failed' : 'success',
      },
      update: {
        lastSyncAt: new Date(),
        recordsAdded: added,
        recordsUpdated: updated,
        recordsFailed: failed,
        status: failed > 0 && added === 0 && updated === 0 ? 'failed' : 'success',
      },
    })
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to write sync log:`, err)
  }

  console.log(
    `${LOG_PREFIX} Sync complete: ${added} added, ${updated} updated, ${failed} failed (of ${records.length})`
  )
  return { added, updated, failed, total: records.length, errors: errors.slice(0, 50) }
}
