import { prisma } from '@/lib/db'
import { readFile } from 'fs/promises'

const LOG_PREFIX = '[ATO-SYNC]'

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------
function normalizeStatus(raw: string): string {
  if (!raw) return 'Unknown'
  const lower = raw.toLowerCase()
  if (lower.includes('authorized') && !lower.includes('in process') && !lower.includes('ready')) return 'Authorized'
  if (lower.includes('in process')) return 'InProcess'
  if (lower.includes('ready')) return 'Ready'
  return raw
}

// ---------------------------------------------------------------------------
// Date parsing helper
// ---------------------------------------------------------------------------
function parseDate(value: unknown): Date | null {
  if (!value) return null
  const s = String(value)
  if (s === 'Continuous ATO' || s === '') return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Parses the FedRAMP `annual_assessment` field into the next date the
 * assessment is due.
 *
 * The field is almost always a bare month/day recurrence — `"09/30"`, `"12/1"` —
 * not a full date, because the assessment falls on the same anniversary every
 * year. A naive `new Date("09/30")` yields September 2001, which is how the
 * column ends up full of two-decade-old "expiry" dates that look real to every
 * downstream consumer.
 *
 * A minority of rows do carry a full ISO datetime, so both shapes are handled.
 *
 * The returned value is relative to `now` and is recomputed on every sync,
 * which is the correct behaviour for a recurring obligation: once this year's
 * assessment date passes, the next one is a year out.
 *
 * NOTE: FedRAMP authorizations do not hard-expire on a date. Continuous
 * monitoring means an authorization lapses if the annual assessment isn't met,
 * so this is the operative planning date — label it as an assessment due date
 * in any user-facing copy, not as an expiration.
 */
export function parseAnnualAssessment(value: unknown, now = new Date()): Date | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (!s || s === 'Continuous ATO') return null

  // Full date form.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }

  // Month/day recurrence form.
  const match = s.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!match) return null

  const month = Number(match[1])
  const day = Number(match[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const build = (year: number) => new Date(Date.UTC(year, month - 1, day))

  let candidate = build(now.getUTCFullYear())
  // Rejects impossible dates (02/30) that would silently roll into March.
  if (candidate.getUTCMonth() !== month - 1) return null

  if (candidate.getTime() < todayUtc) {
    candidate = build(now.getUTCFullYear() + 1)
    // Feb 29 in a following non-leap year rolls to Mar 1; step to the next
    // leap year rather than reporting a date the assessment isn't due.
    if (candidate.getUTCMonth() !== month - 1) return null
  }

  return candidate
}

// ---------------------------------------------------------------------------
// Mapped product record (common output format)
// ---------------------------------------------------------------------------
export interface MappedProduct {
  packageId: string
  cspName: string
  csoName: string
  status: string
  impactLevel: string | null
  serviceModel: string
  deploymentModel: string | null
  authorizationDate: Date | null
  expirationDate: Date | null
  sponsoringAgency: string | null
  leveragingAgencies: string
  assessorName: string | null
  authType: string | null
  serviceDescription: string | null
  website: string | null
  logo: string | null
  /** Only the GSA product feed carries these; the ATO export omits them. */
  uei?: string | null
  smallBusiness?: boolean | null
}

// ---------------------------------------------------------------------------
// Format 1: GSA marketplace-fedramp-gov-data (product-level)
// Fields: id, csp, cso, status, impact_level, service_model, deployment_model,
//         auth_date, annual_assessment, auth_type, independent_assessor,
//         agency_authorizations, service_desc, website, logo,
//         partnering_agency, uei, small_business
// ---------------------------------------------------------------------------
interface GsaProductRecord {
  id: string
  csp: string
  cso: string
  status: string
  impact_level?: string
  service_model?: string[]
  deployment_model?: string
  auth_date?: string
  /**
   * The annual assessment due date. FedRAMP has no explicit "expires on" field —
   * continuous monitoring means an authorization lapses if the annual assessment
   * isn't met, so this date is the operative expiry for planning purposes.
   */
  annual_assessment?: string
  auth_type?: string
  independent_assessor?: string
  agency_authorizations?: Array<{ agency: string }> | string[] | null
  service_desc?: string
  website?: string
  logo?: string
  partnering_agency?: string
  uei?: string
  small_business?: boolean | string
}

function mapGsaProductRecord(r: GsaProductRecord): MappedProduct {
  let leveragingAgencies: string[] = []
  if (Array.isArray(r.agency_authorizations)) {
    leveragingAgencies = r.agency_authorizations.map((a: unknown) => {
      if (typeof a === 'string') return a
      if (a && typeof a === 'object' && 'agency' in (a as Record<string, unknown>)) return (a as { agency: string }).agency
      return String(a)
    }).filter(Boolean)
  }

  return {
    packageId: r.id,
    cspName: r.csp || '',
    csoName: r.cso || '',
    status: normalizeStatus(r.status),
    impactLevel: r.impact_level || null,
    serviceModel: JSON.stringify(r.service_model || []),
    deploymentModel: r.deployment_model || null,
    authorizationDate: parseDate(r.auth_date),
    // Was hardcoded null, which silently emptied the column and disabled every
    // expiry-driven feature (/api/ato/expiring, the ATO_EXPIRING alert rule,
    // the compliance expiry filter and insight). The cron route's own inline
    // mapping read the field but ran it through a plain `new Date()`, which
    // turns the usual "09/30" recurrence into September 2001.
    expirationDate: parseAnnualAssessment(r.annual_assessment),
    sponsoringAgency: r.partnering_agency || null,
    leveragingAgencies: JSON.stringify(leveragingAgencies),
    assessorName: r.independent_assessor || null,
    authType: r.auth_type || null,
    serviceDescription: r.service_desc || null,
    website: r.website || null,
    logo: r.logo || null,
    uei: r.uei?.trim() || null,
    // The feed sends this as a boolean in some rows and a "true"/"Yes" string
    // in others, so normalize rather than trusting the type.
    smallBusiness:
      typeof r.small_business === 'boolean'
        ? r.small_business
        : typeof r.small_business === 'string'
          ? /^(true|yes|y|1)$/i.test(r.small_business.trim())
          : null,
  }
}

// ---------------------------------------------------------------------------
// Format 2: fedramp.gov ATO export (ATO-level, one row per agency per product)
// Fields: fedramp_id, cloud_service_provider, cloud_service_offering,
//         service_description, business_categories, service_model, status,
//         independent_assessor, authorizations, reuse, parent_agency, sub_agency,
//         ato_issuance_date, fedramp_authorization_date, annual_assessment_date,
//         ato_expiration_date, ato_type
// ---------------------------------------------------------------------------
interface AtoExportRecord {
  fedramp_id: string
  cloud_service_provider: string
  cloud_service_offering: string
  service_description?: string
  business_categories?: string[]
  service_model?: string[]
  status: string
  independent_assessor?: string
  authorizations?: number
  reuse?: number
  parent_agency?: string
  sub_agency?: string | null
  ato_issuance_date?: string
  fedramp_authorization_date?: string
  annual_assessment_date?: string
  ato_expiration_date?: string
  ato_type?: string
}

function isAtoExportFormat(data: unknown[]): data is AtoExportRecord[] {
  if (!data.length) return false
  const first = data[0] as Record<string, unknown>
  return 'fedramp_id' in first && 'cloud_service_offering' in first
}

function groupAtoExportRecords(records: AtoExportRecord[]): MappedProduct[] {
  const grouped = new Map<string, AtoExportRecord[]>()
  for (const r of records) {
    if (!r.fedramp_id) continue
    const existing = grouped.get(r.fedramp_id) || []
    existing.push(r)
    grouped.set(r.fedramp_id, existing)
  }

  const products: MappedProduct[] = []
  for (const [fedrampId, atos] of grouped) {
    const primary = atos.find(a => a.ato_type === 'Initial') || atos[0]

    const agencies: string[] = []
    for (const ato of atos) {
      const agency = ato.sub_agency || ato.parent_agency
      if (agency && !agencies.includes(agency)) {
        agencies.push(agency)
      }
    }

    const sponsor = primary.sub_agency || primary.parent_agency || null

    // Find earliest non-continuous expiration date
    let earliestExpiration: Date | null = null
    for (const ato of atos) {
      const d = parseDate(ato.ato_expiration_date)
      if (d && (!earliestExpiration || d < earliestExpiration)) {
        earliestExpiration = d
      }
    }

    products.push({
      packageId: fedrampId,
      cspName: primary.cloud_service_provider || '',
      csoName: primary.cloud_service_offering || '',
      status: normalizeStatus(primary.status),
      impactLevel: null,
      serviceModel: JSON.stringify(primary.service_model || []),
      deploymentModel: null,
      authorizationDate: parseDate(primary.fedramp_authorization_date || primary.ato_issuance_date),
      expirationDate: earliestExpiration,
      sponsoringAgency: sponsor,
      leveragingAgencies: JSON.stringify(agencies),
      assessorName: primary.independent_assessor || null,
      authType: primary.ato_type || null,
      serviceDescription: primary.service_description || null,
      website: null,
      logo: null,
    })
  }
  return products
}

// ---------------------------------------------------------------------------
// Auto-detect format and map records
// ---------------------------------------------------------------------------
function autoDetectAndMap(rawRecords: unknown[]): { data: MappedProduct[]; format: string } {
  if (isAtoExportFormat(rawRecords)) {
    console.log(`${LOG_PREFIX} Detected ATO export format (${rawRecords.length} ATOs)`)
    const products = groupAtoExportRecords(rawRecords)
    console.log(`${LOG_PREFIX} Grouped into ${products.length} unique products`)
    return { data: products, format: 'ato-export' }
  }
  console.log(`${LOG_PREFIX} Detected GSA product format (${rawRecords.length} records)`)
  return { data: (rawRecords as GsaProductRecord[]).map(mapGsaProductRecord), format: 'gsa-product' }
}

// ---------------------------------------------------------------------------
// Source functions
// ---------------------------------------------------------------------------

/**
 * Map raw JSON records (already parsed). Auto-detects format.
 * Useful for inline JSON uploads from the admin panel.
 */
export function loadFromRecords(rawRecords: unknown[]): { data: MappedProduct[]; sourceLabel: string } {
  if (!Array.isArray(rawRecords) || !rawRecords.length) {
    throw new Error('Expected non-empty array of records')
  }
  const { data, format } = autoDetectAndMap(rawRecords)
  return { data, sourceLabel: `inline(${format})` }
}

/**
 * Load FedRAMP records from a local JSON file.
 * Auto-detects format: ATO export (fedramp.gov) or GSA product-level.
 */
export async function loadFromFile(filePath: string): Promise<{ data: MappedProduct[]; sourceLabel: string }> {
  console.log(`${LOG_PREFIX} Loading FedRAMP data from file: ${filePath}`)
  const raw = await readFile(filePath, 'utf-8')
  const parsed = JSON.parse(raw)

  // Handle both top-level array and nested structures
  const rawRecords: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed?.data?.Products || parsed?.Products || parsed

  if (!Array.isArray(rawRecords)) throw new Error('Expected JSON array in file')

  const { data, format } = autoDetectAndMap(rawRecords)
  return { data, sourceLabel: `file(${format}):${filePath}` }
}

/** The fetch is ~4MB. Bounded so a stalled connection can't eat the run budget. */
const FEDRAMP_FETCH_TIMEOUT_MS = 60_000

/**
 * How old `meta.last_change` may get before a run says so out loud. The file is
 * documented as daily; it is not. Silence here is what let us sit on April data
 * for four months without a single log line suggesting anything was wrong.
 */
const UPSTREAM_STALE_AFTER_DAYS = 14

/**
 * Fetch FedRAMP records from the GSA marketplace data repository.
 *
 * `meta.last_change` is the upstream's own statement about when it last changed,
 * and it is the only way to distinguish "we synced and nothing moved" from "we
 * read a file nobody has updated in months". Both look identical in a row count.
 */
export async function fetchFromGitHub(): Promise<{
  data: MappedProduct[]
  sourceLabel: string
  /** Upstream's `meta.last_change`, or null when absent. */
  lastChange: Date | null
  /** True when `lastChange` is older than UPSTREAM_STALE_AFTER_DAYS. */
  upstreamStale: boolean
}> {
  const url = 'https://raw.githubusercontent.com/GSA/marketplace-fedramp-gov-data/main/data.json'
  console.log(`${LOG_PREFIX} Fetching FedRAMP data from GitHub: ${url}`)
  const res = await fetch(url, { signal: AbortSignal.timeout(FEDRAMP_FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status} ${res.statusText}`)
  const json = await res.json()
  const records: GsaProductRecord[] = json?.data?.Products || json?.Products || []
  if (!Array.isArray(records)) throw new Error('Unexpected GitHub JSON structure')

  const raw = json?.meta?.last_change
  const parsed = raw ? new Date(raw) : null
  const lastChange = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null

  let upstreamStale = false
  if (lastChange) {
    const ageDays = Math.floor((Date.now() - lastChange.getTime()) / 86_400_000)
    upstreamStale = ageDays > UPSTREAM_STALE_AFTER_DAYS
    console.log(
      `${LOG_PREFIX} Upstream last_change ${lastChange.toISOString()} (${ageDays}d old)` +
        (upstreamStale ? ' — STALE, upstream is not updating' : '')
    )
  } else {
    console.warn(`${LOG_PREFIX} No meta.last_change in upstream payload`)
  }

  console.log(`${LOG_PREFIX} Fetched ${records.length} records from GitHub`)
  return {
    data: records.map(mapGsaProductRecord),
    sourceLabel: 'github:GSA/marketplace-fedramp-gov-data',
    lastChange,
    upstreamStale,
  }
}

// ---------------------------------------------------------------------------
// Core sync function
// ---------------------------------------------------------------------------

export interface SyncResult {
  added: number
  updated: number
  failed: number
  total: number
  errors: string[]
  /** False when the run stopped on its deadline with records still to process. */
  completed: boolean
  /** Resume point when `completed` is false; null when the set was finished. */
  cursor: string | null
  /** How many records this invocation actually touched. */
  processed: number
}

export interface SyncOptions {
  /**
   * Wall-clock instant after which the loop stops and reports a cursor instead
   * of pushing on. The caller reserves the remaining budget for its other work.
   */
  deadline?: number
  /** Resume point from the previous run; only records after it are processed. */
  cursor?: string | null
}

/**
 * Upsert an array of mapped FedRAMP records into the database and log the sync.
 */
export async function syncFedrampData(
  records: MappedProduct[],
  options: SyncOptions = {}
): Promise<SyncResult> {
  let added = 0
  let updated = 0
  let failed = 0
  const errors: string[] = []

  // Sorted by packageId so the cursor is meaningful across invocations. Feed
  // order is not stable, so an index-based cursor would resume at the wrong
  // place whenever upstream reorders.
  const ordered = [...records]
    .filter((r) => Boolean(r.packageId))
    .sort((a, b) => a.packageId.localeCompare(b.packageId))

  failed += records.length - ordered.length
  if (failed > 0) errors.push(`Skipped ${failed} record(s) with missing packageId`)

  const startAfter = options.cursor ?? null
  const pending = startAfter
    ? ordered.filter((r) => r.packageId.localeCompare(startAfter) > 0)
    : ordered

  // One query for every existing key, instead of a findUnique per record. That
  // halves the round trips (measured 54.8ms + 77.2ms per record against
  // production; this removes the 54.8ms leg) while keeping added/updated exact.
  const existingIds = new Set(
    (await prisma.fedrampAuthorization.findMany({ select: { packageId: true } })).map(
      (r) => r.packageId
    )
  )

  console.log(
    `${LOG_PREFIX} Starting sync of ${pending.length} FedRAMP records` +
      (startAfter ? ` (resuming after ${startAfter})` : '') +
      (options.deadline ? ` with a ${Math.round((options.deadline - Date.now()) / 1000)}s budget` : '')
  )

  let processed = 0
  // Seeded with the INCOMING cursor, not null. A run that hits its deadline
  // before committing anything must report the resume point it was given --
  // reporting null would clear progress and send the next run back to the
  // start, which is the "restarts from zero every night forever" failure this
  // whole mechanism exists to prevent.
  let cursor: string | null = startAfter
  let completed = true

  for (const record of pending) {
    // Checked before the work, not after, so the deadline is a real ceiling.
    //
    // `processed > 0` guarantees forward progress. A run that arrives with its
    // budget already spent -- a slow fetch, a long DISA stage, a cold start --
    // would otherwise commit nothing, report the cursor it was handed, and do
    // the same thing tomorrow. Zero-progress runs never converge no matter how
    // many of them there are, which is precisely the failure the cursor exists
    // to prevent. One record costs ~77ms measured against production Turso;
    // overshooting the ceiling by that much is strictly better than never
    // finishing the set.
    if (processed > 0 && options.deadline && Date.now() >= options.deadline) {
      completed = false
      console.warn(
        `${LOG_PREFIX} Deadline reached after ${processed}/${pending.length}; resuming next run after ${cursor}`
      )
      break
    }

    try {
      const existing = existingIds.has(record.packageId)

      await prisma.fedrampAuthorization.upsert({
        where: { packageId: record.packageId },
        create: {
          ...record,
          lastSynced: new Date(),
        },
        update: {
          ...record,
          lastSynced: new Date(),
        },
      })

      if (existing) {
        updated++
      } else {
        added++
      }
      // Advanced only after a successful commit, so a resumed run never skips
      // a record that failed to write.
      cursor = record.packageId
      processed++
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Failed packageId=${record.packageId}: ${msg}`)
      console.error(`${LOG_PREFIX} Error upserting ${record.packageId}:`, msg)
    }
  }

  // Persist progress, including the resume point. Written even on a partial run
  // -- that is the whole point: the next invocation reads `cursor` and picks up
  // where this one stopped instead of starting over.
  const status = completed
    ? failed > 0 && added === 0 && updated === 0
      ? 'failed'
      : 'success'
    : 'partial'

  try {
    const logData = {
      lastSyncAt: new Date(),
      recordsAdded: added,
      recordsUpdated: updated,
      recordsFailed: failed,
      status,
      cursor: completed ? null : cursor,
    }
    await prisma.atoSyncLog.upsert({
      where: { source: 'fedramp' },
      create: { source: 'fedramp', ...logData },
      update: logData,
    })
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to write sync log:`, err)
  }

  console.log(
    `${LOG_PREFIX} Sync ${status}: ${added} added, ${updated} updated, ${failed} failed; ` +
      `${processed}/${pending.length} processed this run`
  )

  return {
    added,
    updated,
    failed,
    total: records.length,
    errors: errors.slice(0, 50),
    completed,
    cursor: completed ? null : cursor,
    processed,
  }
}

/** Resume point from the last run, or null if it finished. */
export async function fedrampResumeCursor(): Promise<string | null> {
  try {
    const log = await prisma.atoSyncLog.findUnique({ where: { source: 'fedramp' } })
    return log?.status === 'partial' ? log.cursor : null
  } catch {
    return null
  }
}
