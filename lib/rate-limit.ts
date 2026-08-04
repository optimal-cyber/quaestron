import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * LibSQL-backed fixed-window rate limiter — no extra infrastructure.
 *
 * The window index is baked into the key (`bucket:id:windowIndex`), so a single
 * upsert both creates the counter and increments it; there is no reset path and
 * no read-then-write race. Expired rows are swept opportunistically.
 *
 * Fails OPEN: if the database is unreachable we serve the request rather than
 * take the public API down over a counter.
 */

export interface RateLimitRule {
  /** Namespace, e.g. 'search'. Keeps buckets independent per route. */
  bucket: string
  /** Max requests allowed per window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  /** Unix ms at which the current window ends. */
  resetAt: number
}

export const RATE_LIMITS = {
  search: { bucket: 'search', limit: 60, windowSeconds: 60 },
  entities: { bucket: 'entities', limit: 120, windowSeconds: 60 },
  vendor: { bucket: 'vendor', limit: 60, windowSeconds: 60 },
  /** On-demand enrichment is expensive (external APIs) — keep it tight. */
  vendorSync: { bucket: 'vendor-sync', limit: 5, windowSeconds: 300 },
} as const satisfies Record<string, RateLimitRule>

/** Best-effort client identity: first hop of x-forwarded-for, else a shared bucket. */
export function clientId(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function checkRateLimit(
  rule: RateLimitRule,
  identifier: string
): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000
  const now = Date.now()
  const windowIndex = Math.floor(now / windowMs)
  const resetAt = (windowIndex + 1) * windowMs
  const key = `${rule.bucket}:${identifier}:${windowIndex}`

  try {
    const row = await prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, expiresAt: new Date(resetAt) },
      update: { count: { increment: 1 } },
      select: { count: true },
    })

    // ~1-in-200 requests pays for the sweep of stale counters.
    if (Math.random() < 0.005) {
      void prisma.rateLimit
        .deleteMany({ where: { expiresAt: { lt: new Date(now) } } })
        .catch(() => {})
    }

    return {
      allowed: row.count <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - row.count),
      resetAt,
    }
  } catch (err) {
    console.error('[rate-limit] check failed, failing open:', err)
    return { allowed: true, limit: rule.limit, remaining: rule.limit, resetAt }
  }
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  }
}

/**
 * Guard for route handlers. Returns a 429 response when over the limit,
 * otherwise headers to merge into the successful response.
 *
 *   const limited = await enforceRateLimit(request, RATE_LIMITS.search)
 *   if (limited.response) return limited.response
 */
export async function enforceRateLimit(
  request: Request,
  rule: RateLimitRule,
  identifier = clientId(request)
): Promise<{ response: NextResponse | null; headers: Record<string, string> }> {
  const result = await checkRateLimit(rule, identifier)
  const headers = rateLimitHeaders(result)

  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
    return {
      response: NextResponse.json(
        { data: null, error: 'Rate limit exceeded' },
        { status: 429, headers: { ...headers, 'Retry-After': String(retryAfter) } }
      ),
      headers,
    }
  }

  return { response: null, headers }
}
