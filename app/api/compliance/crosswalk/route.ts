import { z } from 'zod'
import { ok, fail, parseQuery } from '@/lib/api/response'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { buildCrosswalk } from '@/lib/compliance/crosswalk'

const querySchema = z.object({
  entity: z.string().trim().min(1).max(160),
})

/**
 * Unified compliance + spend view for one vendor.
 * `?entity=` accepts a slug or an entity id.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.vendor)
  if (limited.response) return limited.response

  const parsed = parseQuery(querySchema, new URL(request.url))
  if (!parsed.ok) return parsed.response

  const crosswalk = await buildCrosswalk(parsed.value.entity)
  if (!crosswalk) return fail('Vendor not found', 404)

  return ok(crosswalk, { headers: limited.headers })
}
