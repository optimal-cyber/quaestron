import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

/**
 * Single entry point for privileged (admin / sync / seed) route auth.
 *
 * Replaces the per-route `SYNC_API_KEY` / `CRON_SECRET` header checks that were
 * copy-pasted across ~12 handlers. Three accepted credentials:
 *
 *   1. `Authorization: Bearer <SYNC_API_KEY | ADMIN_SECRET>`   (machine callers)
 *   2. `x-cron-secret: <CRON_SECRET>` or `?secret=<CRON_SECRET>`
 *      when `allowCronSecret` is set                          (legacy seed routes)
 *   3. A signed-in session whose `User.role` is `ADMIN`       (the admin UI)
 *
 * Hardening change vs. the previous behaviour: routes used to allow *anyone*
 * when no secret env var was configured. That open-by-default fallback now only
 * applies outside production — in production, an unconfigured secret denies.
 */

export interface AdminAuthOptions {
  /**
   * Also accept the legacy `x-cron-secret` header or `?secret=` query param,
   * checked against CRON_SECRET. Kept for the /api/sync/seed-* routes, which
   * are invoked by hand and by external schedulers with that convention.
   */
  allowCronSecret?: boolean
}

export type AdminAuth =
  | { ok: true; via: 'session' | 'secret' | 'dev' }
  | { ok: false; response: NextResponse }

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function bearer(request: Request): string | null {
  const header = request.headers.get('Authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

function unauthorized(): NextResponse {
  return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
}

/** Secrets that grant privileged access, in the order they were historically used. */
function configuredSecrets(): string[] {
  return [process.env.SYNC_API_KEY, process.env.ADMIN_SECRET].filter(
    (s): s is string => Boolean(s)
  )
}

export async function requireAdminRequest(
  request: Request,
  options: AdminAuthOptions = {}
): Promise<AdminAuth> {
  const secrets = configuredSecrets()
  const token = bearer(request)

  if (token && secrets.some((s) => safeEqual(token, s))) {
    return { ok: true, via: 'secret' }
  }

  if (options.allowCronSecret && process.env.CRON_SECRET) {
    const provided =
      request.headers.get('x-cron-secret') || new URL(request.url).searchParams.get('secret')
    if (provided && safeEqual(provided, process.env.CRON_SECRET)) {
      return { ok: true, via: 'secret' }
    }
  }

  const user = await getSessionUser()
  if (user?.role === 'ADMIN') return { ok: true, via: 'session' }

  // No secret configured at all: permissive in local dev, closed in production.
  const anySecretConfigured = secrets.length > 0 || Boolean(process.env.CRON_SECRET)
  if (!anySecretConfigured && process.env.NODE_ENV !== 'production') {
    return { ok: true, via: 'dev' }
  }

  return { ok: false, response: unauthorized() }
}

/**
 * Vercel Cron and other scheduled callers. Strictly `Bearer <CRON_SECRET>` —
 * sessions are deliberately not accepted here.
 */
export function requireCronRequest(request: Request): AdminAuth {
  const secret = process.env.CRON_SECRET
  const token = bearer(request)

  if (secret && token && safeEqual(token, secret)) return { ok: true, via: 'secret' }
  if (!secret && process.env.NODE_ENV !== 'production') return { ok: true, via: 'dev' }

  return { ok: false, response: unauthorized() }
}
