import { prisma } from '@/lib/db'
import { readFile } from 'fs/promises'
import * as XLSX from 'xlsx'

const LOG_PREFIX = '[DISA-SYNC]'

/**
 * DISA's actual filename shape, confirmed against the live server:
 *
 *   .../xls/DCAS-Current_Authorized_CSOs-2026-07-08.xlsx   -> 200
 *
 * This code previously built `DCAS+Current+Authorized+CSOs+-+<date>.xlsx`, as
 * though the spaces in the display name were plus-encoded. That URL 404s for
 * every date, so the probe walk could never have succeeded -- it was not a slow
 * or fragile path, it was a dead one, and the per-probe timeouts and stage
 * budget added earlier were making a doomed loop fail faster.
 */
const DCAS_URL_PREFIX =
  'https://dl.dod.cyber.mil/wp-content/uploads/cloud/xls/DCAS-Current_Authorized_CSOs-'
const DCAS_URL_SUFFIX = '.xlsx'
/**
 * DISA keeps only the CURRENT file and replaces it; older dates are removed. A
 * 150-day sweep of the live server returned exactly one hit (2026-07-08), and
 * publication looks roughly monthly rather than weekly.
 *
 * So the window has to span more than one publication cycle: if a file lands on
 * the 8th and the next is late, the newest existing file can be 60+ days old. A
 * 35-day window would have found today's file with a week to spare and then
 * silently failed the first time a cycle slipped.
 */
const PROBE_DAYS = 120
/**
 * Probes run in parallel batches. Serially, a 45s stage budget at 5s per probe
 * buys ~9 attempts -- fewer than the 28 days back today's file already sits, so
 * a serial walk over a 120-day window cannot finish. 404s come back in a few
 * hundred milliseconds, so batching turns 120 probes into ~15 rounds.
 */
const PROBE_CONCURRENCY = 8
/**
 * Roughly how often DISA publishes. While the cached file is younger than this,
 * probing is skipped entirely — a monthly file does not need a daily search,
 * and this run has no budget to spare for one.
 */
const EXPECTED_CADENCE_DAYS = 30
/**
 * Past this, DISA has missed more than a full cycle and something has probably
 * changed. Worth saying out loud precisely because nothing else can tell: a
 * stale file downloads and parses exactly like a fresh one, which is how a dead
 * probe went unnoticed for months in the first place.
 */
const STALE_AFTER_DAYS = 45
/** Per-probe ceiling. */
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

export function dcasUrlForDate(date: Date): string {
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

  // Never probe further back than a date already known to exist. Once a file
  // has been found, later runs probe only the days since it, so the steady
  // state is a handful of requests rather than the full window.
  const cached = await lastKnownDcasDate()
  let daysBack = options.daysBack ?? PROBE_DAYS
  if (cached) {
    const cachedMs = Date.parse(`${cached}T00:00:00Z`)
    if (!Number.isNaN(cachedMs)) {
      const daysSince = Math.floor((start.getTime() - cachedMs) / 86_400_000)

      // DISA publishes roughly monthly. Probing daily for a monthly file spends
      // budget in a run that has none to spare, so until the next edition is
      // plausibly out we skip the walk entirely and reuse what we have.
      if (daysSince < EXPECTED_CADENCE_DAYS) {
        console.log(
          `${LOG_PREFIX} Cached ${cached} is ${daysSince}d old; next edition not due for ` +
            `${EXPECTED_CADENCE_DAYS - daysSince}d — skipping probe`
        )
        const url = dcasUrlForDate(new Date(cachedMs))
        return { buffer: await download(url), url, publishDate: cached }
      }

      // Past this point DISA has missed more than a full cycle. The file still
      // downloads and still parses, so nothing else in the pipeline can tell
      // the difference — this log line is the only thing that will.
      if (daysSince > STALE_AFTER_DAYS) {
        console.warn(
          `${LOG_PREFIX} STALE: no new DCAS file in ${daysSince} days (cached ${cached}, ` +
            `expected roughly every ${EXPECTED_CADENCE_DAYS}). DISA may have changed its ` +
            `publication pattern or filename format again.`
        )
      }

      daysBack = Math.max(0, Math.min(daysBack, daysSince))
    }
  }

  const probeDeadline = Date.now() + PROBE_TOTAL_MS
  let probed = 0

  // Newest first, in batches, so a newer publication still wins over the cached
  // one. Within a batch the earliest index that exists wins, which keeps the
  // result identical to a serial newest-first walk.
  for (let base = 0; base <= daysBack; base += PROBE_CONCURRENCY) {
    if (Date.now() >= probeDeadline) {
      console.warn(
        `${LOG_PREFIX} Probe budget spent after ${probed} URLs; falling back to the cached file`
      )
      break
    }

    const batch: Array<{ index: number; date: Date; url: string }> = []
    for (let i = base; i < Math.min(base + PROBE_CONCURRENCY, daysBack + 1); i++) {
      const date = new Date(start)
      date.setUTCDate(date.getUTCDate() - i)
      batch.push({ index: i, date, url: dcasUrlForDate(date) })
    }

    const settled = await Promise.all(
      batch.map(async (candidate) => {
        try {
          const head = await probeExists(candidate.url)
          if (head === 'unsupported') {
            const res = await fetch(candidate.url, {
              redirect: 'follow',
              signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            })
            return { ...candidate, found: res.ok }
          }
          return { ...candidate, found: head }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(`${LOG_PREFIX} Probe error for ${candidate.url}: ${msg}`)
          return { ...candidate, found: false }
        }
      })
    )
    probed += settled.length

    const hit = settled.filter((s) => s.found).sort((a, b) => a.index - b.index)[0]
    if (hit) {
      const buffer = await download(hit.url)
      const publishDate = ymd(hit.date)
      console.log(`${LOG_PREFIX} Found DCAS xlsx: ${hit.url} (${buffer.length} bytes)`)
      await rememberDcasDate(publishDate)
      return { buffer, url: hit.url, publishDate }
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
    `No DCAS xlsx found in the last ${daysBack} days (probed ${probed} URLs back from ${ymd(start)})`
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
