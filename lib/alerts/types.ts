import { z } from 'zod'
import type { Tier } from '@/lib/auth'

export const RULE_TYPES = [
  'NEW_CONTRACT',
  'FEDRAMP_STATUS_CHANGE',
  'ATO_EXPIRING',
  'NEW_SBIR_AWARD',
  'RISK_FLAG_ADDED',
  'NEWS_MENTION',
] as const
export type RuleType = (typeof RULE_TYPES)[number]

export const TARGET_TYPES = ['ENTITY', 'FEDRAMP_CSO', 'AGENCY', 'KEYWORD', 'NAICS'] as const
export type TargetType = (typeof TARGET_TYPES)[number]

export const CHANNELS = ['EMAIL', 'IN_APP'] as const
export type Channel = (typeof CHANNELS)[number]

export const FREQUENCIES = ['REALTIME', 'DAILY', 'WEEKLY'] as const
export type Frequency = (typeof FREQUENCIES)[number]

export const RULE_LABELS: Record<RuleType, string> = {
  NEW_CONTRACT: 'New contract award',
  FEDRAMP_STATUS_CHANGE: 'FedRAMP status change',
  ATO_EXPIRING: 'Authorization expiring',
  NEW_SBIR_AWARD: 'New SBIR/STTR award',
  RISK_FLAG_ADDED: 'Risk flag added',
  NEWS_MENTION: 'News mention',
}

export const TARGET_LABELS: Record<TargetType, string> = {
  ENTITY: 'Vendor',
  FEDRAMP_CSO: 'FedRAMP offering',
  AGENCY: 'Agency',
  KEYWORD: 'Keyword',
  NAICS: 'NAICS code',
}

/** Which target types each rule can actually act on. Used to validate and to
 *  explain in the UI why a rule produced nothing. */
export const RULE_TARGETS: Record<RuleType, TargetType[]> = {
  NEW_CONTRACT: ['ENTITY', 'AGENCY', 'NAICS'],
  FEDRAMP_STATUS_CHANGE: ['ENTITY', 'FEDRAMP_CSO'],
  ATO_EXPIRING: ['ENTITY', 'FEDRAMP_CSO', 'AGENCY'],
  NEW_SBIR_AWARD: ['ENTITY', 'KEYWORD', 'AGENCY'],
  RISK_FLAG_ADDED: ['ENTITY'],
  NEWS_MENTION: ['ENTITY'],
}

// ─── Tier limits ───────────────────────────────────────────────────

export interface TierLimits {
  maxWatchlists: number
  maxItemsPerWatchlist: number
  frequencies: Frequency[]
  channels: Channel[]
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  FREE: {
    maxWatchlists: 1,
    maxItemsPerWatchlist: 5,
    frequencies: ['WEEKLY'],
    channels: ['EMAIL', 'IN_APP'],
  },
  PRO: {
    maxWatchlists: Number.POSITIVE_INFINITY,
    maxItemsPerWatchlist: Number.POSITIVE_INFINITY,
    frequencies: ['REALTIME', 'DAILY', 'WEEKLY'],
    channels: ['EMAIL', 'IN_APP'],
  },
  TEAM: {
    maxWatchlists: Number.POSITIVE_INFINITY,
    maxItemsPerWatchlist: Number.POSITIVE_INFINITY,
    frequencies: ['REALTIME', 'DAILY', 'WEEKLY'],
    channels: ['EMAIL', 'IN_APP'],
  },
}

export function limitsFor(tier: Tier): TierLimits {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.FREE
}

// ─── Rule params ───────────────────────────────────────────────────

export const ruleParamsSchema = z
  .object({
    /** NEW_CONTRACT: ignore awards below this dollar value. */
    minValue: z.number().nonnegative().optional(),
    /** ATO_EXPIRING: how far ahead to look. */
    days: z.number().int().min(1).max(365).optional(),
  })
  .strict()

export type RuleParams = z.infer<typeof ruleParamsSchema>

export function parseParams(raw: string): RuleParams {
  try {
    const parsed = ruleParamsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

// ─── Engine shapes ─────────────────────────────────────────────────

/** A candidate alert, before it has been persisted and deduped. */
export interface CandidateEvent {
  dedupeKey: string
  title: string
  body: string
  url?: string | null
  entityId?: string | null
}

export interface ResolvedTarget {
  targetType: TargetType
  targetKey: string
  targetId: string | null
  targetValue: string | null
  label: string | null
}

export interface EvaluatorContext {
  ruleId: string
  ruleType: RuleType
  params: RuleParams
  targets: ResolvedTarget[]
  /** Only consider source rows created at or after this instant. */
  since: Date
  now: Date
}

/**
 * Bounds on a single evaluation run. Rules fan out over watchlist items, so
 * without caps one enthusiastic user could make a cron run unbounded.
 */
export const ENGINE_LIMITS = {
  maxRulesPerRun: 500,
  maxEventsPerRule: 50,
  maxTargetsPerRule: 200,
  /** Lookback for "new row" rules. Wider than the daily cadence so a skipped
   *  or failed run self-heals; dedupeKey makes the overlap harmless. */
  lookbackDays: 7,
} as const

/** Expiry thresholds that each fire once, so users get escalating notice
 *  instead of the same alert every single day. */
export const EXPIRY_BUCKETS = [90, 60, 30, 14, 7] as const

/** The bucket an authorization currently falls into, or null if beyond range. */
export function expiryBucket(daysRemaining: number): number | null {
  for (const bucket of [...EXPIRY_BUCKETS].sort((a, b) => a - b)) {
    if (daysRemaining <= bucket) return bucket
  }
  return null
}
