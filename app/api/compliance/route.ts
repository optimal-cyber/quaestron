import { z } from 'zod'
import { ok, parseQuery } from '@/lib/api/response'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { queryUniverse, universeFacets, universeTotals } from '@/lib/compliance/universe'

const querySchema = z.object({
  search: z.string().trim().max(120).optional(),
  // Free string, not an enum: the FedRAMP feed carries designations beyond
  // Low/Moderate/High (LI-SaaS, 20x Low/Moderate) and can add more. The UI
  // populates this control from live facet values.
  impactLevel: z.string().trim().max(40).optional(),
  status: z.string().trim().max(40).optional(),
  agency: z.string().trim().max(160).optional(),
  businessSize: z.enum(['SMALL', 'OTHER']).optional(),
  setAside: z.string().trim().max(40).optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(1095).optional(),
  source: z.enum(['fedramp', 'dod-pa']).optional(),
  sort: z.enum(['expiration', 'obligated', 'vendor', 'level']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Include facet lists and universe totals — the page asks once on first load. */
  facets: z.enum(['0', '1']).optional(),
})

/** Filterable table of the authorized-cloud universe (FedRAMP + DoD PA). */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.entities)
  if (limited.response) return limited.response

  const parsed = parseQuery(querySchema, new URL(request.url))
  if (!parsed.ok) return parsed.response
  const { facets, ...filters } = parsed.value

  const [result, facetData, totals] = await Promise.all([
    queryUniverse(filters),
    facets === '1' ? universeFacets() : Promise.resolve(null),
    facets === '1' ? universeTotals() : Promise.resolve(null),
  ])

  return ok(
    {
      ...result,
      ...(facetData ? { facets: facetData } : {}),
      ...(totals ? { totals } : {}),
    },
    { headers: limited.headers }
  )
}
