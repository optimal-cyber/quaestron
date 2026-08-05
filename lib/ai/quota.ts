import { checkRateLimit, peekRateLimit } from '@/lib/rate-limit'
import { tierAtLeast, type SessionUser } from '@/lib/auth'

/**
 * Analyst access policy.
 *
 * Pro and Team get unlimited messages. Free gets a daily allowance rather than
 * a hard block, so the feature is demonstrable without a subscription — the
 * spec's "Free gets 5 messages/day".
 *
 * The counter reuses the Phase 1 LibSQL fixed-window limiter with a 24-hour
 * window keyed on user id. That avoids a second counter table with its own
 * reset semantics, and the window-index-in-the-key design means the daily
 * allowance resets without any scheduled job.
 */

export const FREE_DAILY_MESSAGES = 5

const DAY_SECONDS = 24 * 60 * 60

export interface QuotaDecision {
  allowed: boolean
  /** Null for unlimited tiers. */
  remaining: number | null
  limit: number | null
  resetAt: number | null
  reason?: string
}

/**
 * `consume: false` reports the current standing without spending an allowance —
 * used by the UI to render the counter. Only the send path consumes.
 */
export async function checkAnalystQuota(
  user: SessionUser,
  options: { consume: boolean }
): Promise<QuotaDecision> {
  if (tierAtLeast(user.tier, 'PRO')) {
    return { allowed: true, remaining: null, limit: null, resetAt: null }
  }

  const rule = {
    bucket: 'analyst-daily',
    limit: FREE_DAILY_MESSAGES,
    windowSeconds: DAY_SECONDS,
  }

  // Rendering the remaining count must not itself spend one of the five.
  const result = options.consume
    ? await checkRateLimit(rule, user.id)
    : await peekRateLimit(rule, user.id)
  return {
    allowed: result.allowed,
    remaining: result.remaining,
    limit: FREE_DAILY_MESSAGES,
    resetAt: result.resetAt,
    reason: result.allowed
      ? undefined
      : `Free tier is limited to ${FREE_DAILY_MESSAGES} analyst messages per day. Upgrade to Pro for unlimited access.`,
  }
}
