import { z } from 'zod'
import { ok, parseQuery } from '@/lib/api/response'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { buildInsights } from '@/lib/compliance/insights'

const querySchema = z.object({
  expiringWindowDays: z.coerce.number().int().min(1).max(1095).default(180),
  newlyAuthorizedWindowDays: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * Derived compliance insights: expiring ATOs by agency, small-business
 * authorizations by level, authorized-but-unfunded whitespace, and newly
 * authorized offerings.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.entities)
  if (limited.response) return limited.response

  const parsed = parseQuery(querySchema, new URL(request.url))
  if (!parsed.ok) return parsed.response

  const insights = await buildInsights(parsed.value)
  return ok(insights, { headers: limited.headers })
}
