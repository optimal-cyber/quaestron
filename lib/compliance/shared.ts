/**
 * Shared vocabulary for the compliance module.
 *
 * FedRAMP and DoD speak different impact-level dialects — FedRAMP grades
 * Low/Moderate/High, DoD grades IL2/IL4/IL5/IL6 — and the UI has to filter
 * across both in one control. These helpers keep that translation in one place.
 */

/**
 * The impact levels that actually appear in the FedRAMP feed — including
 * `LI-SaaS` (Low-Impact SaaS) and the `20x` designations from the newer FedRAMP
 * 20x program. The filter must accept these; an enum of just Low/Moderate/High
 * would reject a quarter of the real dataset.
 *
 * The API validates impact level as a free string rather than an enum, because
 * this list is a UI convenience and the feed can add designations at any time.
 * Facet values come from the database, so the UI only ever offers live options.
 */
export const FEDRAMP_LEVELS = ['LI-SaaS', 'Low', '20x Low', 'Moderate', '20x Moderate', 'High'] as const
export const DOD_LEVELS = ['IL2', 'IL4', 'IL5', 'IL6'] as const

export const ALL_IMPACT_LEVELS = [...FEDRAMP_LEVELS, ...DOD_LEVELS] as const
export type ImpactLevel = (typeof ALL_IMPACT_LEVELS)[number]

/**
 * Rough equivalence used only for sorting and "highest level" summaries — not
 * for compliance advice. DoD IL4/5/6 have requirements FedRAMP High doesn't
 * cover, so this ranking is a display aid, never an authorization claim.
 */
export const LEVEL_RANK: Record<string, number> = {
  'LI-SaaS': 1,
  Low: 2,
  '20x Low': 2,
  IL2: 3,
  Moderate: 4,
  '20x Moderate': 4,
  IL4: 5,
  High: 6,
  IL5: 7,
  IL6: 8,
}

/**
 * Values that occupy the sponsoring-agency column but name no agency. The
 * FedRAMP feed writes "Not In Process" for offerings without a sponsor, and
 * leaves the field blank for others — between them that is the majority of
 * rows, so treating them as agencies would put "Not In Process" at the top of
 * every agency ranking.
 */
const AGENCY_SENTINELS = new Set([
  'not in process',
  'n/a',
  'na',
  'none',
  'tbd',
  'unknown',
  'in process',
])

export function isRealAgency(name: string | null | undefined): boolean {
  const trimmed = name?.trim()
  if (!trimmed) return false
  return !AGENCY_SENTINELS.has(trimmed.toLowerCase())
}

/** Normalizes an agency field to a real name, or null. */
export function cleanAgency(name: string | null | undefined): string | null {
  return isRealAgency(name) ? name!.trim() : null
}

export function levelRank(level: string | null | undefined): number {
  if (!level) return 0
  return LEVEL_RANK[level] ?? 0
}

/** Highest level in a set, by the display ranking above. */
export function highestLevel(levels: (string | null | undefined)[]): string | null {
  let best: string | null = null
  let bestRank = 0
  for (const level of levels) {
    const rank = levelRank(level)
    if (rank > bestRank) {
      bestRank = rank
      best = level ?? null
    }
  }
  return best
}

export const AUTH_STATUSES = ['Authorized', 'InProcess', 'Ready'] as const

/** A FedRAMP status string counts as live authorization. */
export function isAuthorized(status: string | null | undefined): boolean {
  return Boolean(status && status.toLowerCase().includes('authorized'))
}

export function daysUntil(date: Date | null | undefined, now = new Date()): number | null {
  if (!date) return null
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export function safeJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export interface AgencyBreakdownRow {
  agency: string
  awardCount: number
  totalObligated: number
}

export function safeAgencyBreakdown(raw: string | null | undefined): AgencyBreakdownRow[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r): r is AgencyBreakdownRow => Boolean(r) && typeof r.agency === 'string')
      .map((r) => ({
        agency: r.agency,
        awardCount: Number(r.awardCount) || 0,
        totalObligated: Number(r.totalObligated) || 0,
      }))
  } catch {
    return []
  }
}

export const SET_ASIDE_LABELS: Record<string, string> = {
  SMALL_BUSINESS: 'Small Business',
  '8A': '8(a)',
  WOMAN_OWNED: 'Woman-Owned',
  WOSB: 'WOSB',
  VETERAN_OWNED: 'Veteran-Owned',
  SDVOSB: 'SDVOSB',
  HUBZONE: 'HUBZone',
  MINORITY_OWNED: 'Minority-Owned',
  DISADVANTAGED: 'Disadvantaged',
  NATIVE_AMERICAN: 'Native American',
}

export const RISK_FLAG_LABELS: Record<string, string> = {
  FOREIGN_HQ: 'Foreign HQ',
  SURVEILLANCE_TIES: 'Surveillance ties',
  SAM_INACTIVE: 'SAM inactive',
  EXPIRING_AUTH: 'Expiring authorization',
}
