import NextAuth, { type NextAuthConfig } from 'next-auth'
import type { Provider } from 'next-auth/providers'
import Google from 'next-auth/providers/google'
import Resend from 'next-auth/providers/resend'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export type Tier = 'FREE' | 'PRO' | 'TEAM'
export type Role = 'USER' | 'ADMIN'

/** Higher number = more access. TEAM inherits everything PRO can do. */
const TIER_RANK: Record<Tier, number> = { FREE: 0, PRO: 1, TEAM: 2 }

export interface SessionUser {
  id: string
  email: string | null
  name: string | null
  image: string | null
  tier: Tier
  role: Role
  alertEmailOptIn: boolean
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email?: string | null
      name?: string | null
      image?: string | null
      tier: Tier
      role: Role
      alertEmailOptIn: boolean
    }
  }
}

// Providers are opt-in by env var so local dev works with no secrets at all —
// an unconfigured provider is omitted rather than throwing at import time.
function providers(): Provider[] {
  const list: Provider[] = []

  if (process.env.RESEND_API_KEY) {
    list.push(
      Resend({
        apiKey: process.env.RESEND_API_KEY,
        from: process.env.EMAIL_FROM || 'Iron Echelon <intel@ironechelon.com>',
      })
    )
  }

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    list.push(
      Google({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: true,
      })
    )
  }

  return list
}

/** Which sign-in methods are actually wired up — drives what /signin renders. */
export const enabledProviders = {
  email: Boolean(process.env.RESEND_API_KEY),
  google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
}

export const authConfig: NextAuthConfig = {
  // The Prisma 7 `prisma-client` generator emits to app/generated/prisma, so the
  // adapter's PrismaClient type (sourced from @prisma/client) doesn't structurally
  // match ours even though the runtime shape is identical.
  adapter: PrismaAdapter(prisma as unknown as Parameters<typeof PrismaAdapter>[0]),
  providers: providers(),
  session: {
    // Database sessions (not JWT) so a tier change — e.g. the Stripe webhook in
    // Phase 5 — takes effect on the next request instead of the next token refresh.
    strategy: 'database',
    maxAge: 30 * 24 * 60 * 60,
  },
  trustHost: true,
  pages: {
    signIn: '/signin',
    verifyRequest: '/signin/check-email',
    error: '/signin',
  },
  events: {
    /**
     * Signup notification.
     *
     * Fires once per account, on creation, so it answers the question that
     * actually matters during outreach: did the person I emailed on Tuesday
     * create an account. Polling a CLI cannot tell you within the hour, and an
     * hour is the difference between a warm reply and a cold one.
     *
     * Deliberately non-blocking and swallowed on failure. A notification that
     * throws would surface to the user as a broken sign-in, which trades the
     * thing we care about for the thing we were trying to observe.
     */
    async createUser({ user }) {
      const to = process.env.SIGNUP_NOTIFY_TO
      if (!to || !process.env.RESEND_API_KEY) return
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'Iron Echelon <intel@ironechelon.com>',
          to,
          subject: `New Quaestron signup: ${user.email ?? 'unknown'}`,
          text: [
            `Email:  ${user.email ?? '(none)'}`,
            `Name:   ${user.name ?? '(none)'}`,
            `Time:   ${new Date().toISOString()}`,
            ``,
            `Everyone who has signed up:  npm run users`,
          ].join('\n'),
        })
      } catch (err) {
        console.error('[auth] signup notification failed:', err)
      }
    },
  },
  callbacks: {
    session({ session, user }) {
      // `user` is the freshly-read DB row under the database strategy, so tier
      // and role are always current without an extra query.
      //
      // Rebuilt field-by-field rather than mutated: under the database strategy
      // Auth.js hands us the raw Session row spread onto the object, so
      // returning it as-is would ship `sessionToken`, `stripeCustomerId` and
      // internal timestamps to the client via /api/auth/session.
      const u = user as unknown as {
        id: string
        name?: string | null
        email?: string | null
        image?: string | null
        tier?: string
        role?: string
        alertEmailOptIn?: boolean
      }
      return {
        expires: session.expires,
        user: {
          id: u.id,
          name: u.name ?? null,
          email: u.email ?? null,
          image: u.image ?? null,
          tier: (u.tier as Tier) || 'FREE',
          role: (u.role as Role) || 'USER',
          alertEmailOptIn: u.alertEmailOptIn ?? true,
        },
      }
    },
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)

// ─── Guards ────────────────────────────────────────────────────────

/** Current user, or null when signed out. Never throws. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
    tier: session.user.tier,
    role: session.user.role,
    alertEmailOptIn: session.user.alertEmailOptIn,
  }
}

export function tierAtLeast(userTier: Tier, required: Tier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[required]
}

// ─── Server-component guards (redirect on failure) ─────────────────

/**
 * For server components and server actions. Redirects to /signin when
 * unauthenticated, so callers can treat the return value as always present.
 */
export async function requireUser(callbackUrl?: string): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) {
    const target = callbackUrl ? `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}` : '/signin'
    redirect(target)
  }
  return user
}

/** For server components. Redirects to /signin, or to /pricing when under-tiered. */
export async function requireTier(tier: Tier, callbackUrl?: string): Promise<SessionUser> {
  const user = await requireUser(callbackUrl)
  if (!tierAtLeast(user.tier, tier)) redirect(`/pricing?required=${tier}`)
  return user
}

/** For server components. Redirects home for non-admins (no existence oracle). */
export async function requireAdminUser(callbackUrl?: string): Promise<SessionUser> {
  const user = await requireUser(callbackUrl)
  if (user.role !== 'ADMIN') redirect('/')
  return user
}

// ─── Route-handler guards (return a response on failure) ───────────

export type Guard =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }

function deny(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ data: null, error, ...extra }, { status })
}

/** For route handlers. Returns a 401 response instead of redirecting. */
export async function apiRequireUser(): Promise<Guard> {
  const user = await getSessionUser()
  if (!user) return { ok: false, response: deny(401, 'Authentication required') }
  return { ok: true, user }
}

/** For route handlers. 401 when signed out, 403 with the required tier otherwise. */
export async function apiRequireTier(tier: Tier): Promise<Guard> {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard
  if (!tierAtLeast(guard.user.tier, tier)) {
    return {
      ok: false,
      response: deny(403, `${tier} tier required`, { requiredTier: tier, currentTier: guard.user.tier }),
    }
  }
  return guard
}
