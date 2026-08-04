# Phase 1 — Foundation: Auth, Users, and Hardening

Shipped. The app builds clean, typechecks clean, and stays deployable.

## What shipped

### Auth.js (NextAuth v5)

- `next-auth@5.0.0-beta.32` — the only v5 line; its peer deps explicitly allow
  `next ^16` and `react ^19`. Adapter: `@auth/prisma-adapter@2.11.3`.
- Providers: **Resend magic link** (`next-auth/providers/resend`, HTTP API — no
  `nodemailer` dependency) and **Google OAuth**. Each is registered only when its
  env vars are present, so a deployment with neither still builds and serves;
  `/signin` renders an explicit "no providers configured" notice.
- **Database sessions, not JWT.** With the Prisma adapter the session callback
  receives the freshly-read `User` row, so `tier` and `role` are current on every
  request with no extra query. This matters for Phase 5: a Stripe webhook that
  flips `tier` takes effect immediately rather than at the next token refresh.
- **No auth middleware.** Guards run in server components and route handlers via
  `auth()`. This sidesteps the edge-runtime/Prisma split-config problem in
  NextAuth v5 entirely — there is no second config to keep in sync.
- Route handler at `app/api/auth/[...nextauth]/route.ts`.
- `<SessionProvider>` added in the root layout via `app/providers.tsx` so the
  client-side `TopNav` can render auth state.

### Guards (`lib/auth.ts`)

Two families, because a server component wants a redirect and a route handler
wants a response:

| Server components | Route handlers |
|---|---|
| `requireUser(callbackUrl?)` → redirects to `/signin` | `apiRequireUser()` → 401 |
| `requireTier(tier, callbackUrl?)` → redirects to `/pricing` | `apiRequireTier(tier)` → 403 with `requiredTier`/`currentTier` |
| `requireAdminUser()` → redirects home | — |

Plus `getSessionUser()` (never throws) and `tierAtLeast()`. Tiers rank
`FREE < PRO < TEAM`, so `TEAM` satisfies a `PRO` check.

`requireAdminUser` redirects home rather than returning 403 — a 403 confirms the
panel exists.

### Unified privileged-route auth (`lib/admin-auth.ts`)

Replaced the ad-hoc secret checks copy-pasted across **20 route handlers** with
one helper. Accepted credentials:

1. `Authorization: Bearer <SYNC_API_KEY | ADMIN_SECRET>`
2. `x-cron-secret` header or `?secret=` query matching `CRON_SECRET` — kept for
   the legacy `/api/sync/seed-*` routes so existing callers don't break
3. A signed-in session with `role = ADMIN` — this is new, and it's what makes the
   `/admin` panel's buttons work in production for the first time (the UI never
   sent an `Authorization` header, so with `SYNC_API_KEY` set those endpoints
   were already 401ing)

Comparisons are constant-time (`timingSafeEqual`).

`requireCronRequest()` is separate and stricter: `Bearer $CRON_SECRET` only,
sessions deliberately not accepted. Used by `/api/cron/daily-sync`,
`/api/cron/weekly-sync`, and `/api/sync/surveillance-watch`.

**Behaviour change worth flagging:** these routes used to allow *anyone* when the
relevant secret env var was unset. That open-by-default fallback now applies only
when `NODE_ENV !== 'production'`. In production, an unconfigured secret denies.

### Rate limiting (`lib/rate-limit.ts`)

LibSQL-backed fixed window — no Upstash, no new infrastructure. The window index
is part of the key (`bucket:ip:windowIndex`), so a single `upsert` both creates
and increments the counter: no read-then-write race, no reset path. Expired rows
are swept opportunistically (~0.5% of requests).

| Route | Limit |
|---|---|
| `/api/search` | 60 / min |
| `/api/entities` | 120 / min |
| `/api/vendors`, `/api/vendor/[slug]` | 60 / min |
| on-demand vendor enrichment (inside `/api/vendor/[slug]`) | 5 / 5 min |

The enrichment sub-limit is separate because that path calls SAM, USASpending and
SBIR. Over budget with a cached entity available, it degrades to cached data
rather than 429ing; with nothing cached it returns 429, because a 404 would be a
lie about a vendor we may well know.

Responses carry `X-RateLimit-Limit/Remaining/Reset`; 429s add `Retry-After`.
**Fails open** — a database problem shouldn't take the public API down.

### Schema (additive only)

`User`, `Account`, `Session`, `VerificationToken` per the Auth.js Prisma adapter,
plus on `User`: `tier` (FREE/PRO/TEAM), `role` (USER/ADMIN), `stripeCustomerId`,
`alertEmailOptIn`. And `RateLimit` (`key` PK, `count`, `expiresAt`).

Applied locally with `npx prisma db push --url="file:./dev.db"` — the explicit
`--url` matters, since `prisma.config.ts` prefers `TURSO_DATABASE_URL` and an
unguarded push would target production.

Production migration: `npm run migrate:turso:auth`
(`prisma/migrate-turso-auth.ts`), following the existing `migrate-turso-*.ts`
pattern. Every statement is `IF NOT EXISTS`; safe to re-run. **This has not been
run against production yet** — see Follow-ups.

### UI

- `/signin` — terminal-styled, email + Google, honest about unconfigured
  providers. `?callbackUrl=` is validated to same-origin relative paths only
  (open-redirect guard).
- `/signin/check-email` — magic-link confirmation.
- `components/layout/AuthMenu.tsx` — account dropdown in `TopNav` showing email,
  tier badge, admin link, sign out. Reserves its width while the session loads so
  the nav doesn't shift.
- `app/admin/layout.tsx` — gates the whole admin panel on `role = ADMIN`.

### Bootstrap script

`npm run admin:promote -- you@example.com` (`--demote` to revoke). It **creates**
the user row when absent, not just updates — so the first admin can be
established before any auth provider is configured, and `/admin` is never
unreachable. Signing in with that address later claims the account.

### Docs

- `README.md` — replaced the create-next-app template with real architecture, the
  data-source table, env vars, deploy steps, and the `TURSO_DATABASE_URL`
  footgun called out prominently.
- `.env.example` — all current and Phase 2–5 secrets, annotated.

## Verified

Runtime smoke tests against local `dev.db` (confirmed local, not production, by
matching entity counts):

- `/signin` renders 200 with the no-providers notice
- `/admin` → 307 to `/signin?callbackUrl=%2Fadmin` when signed out
- With a seeded ADMIN session cookie: `/admin` → 200, session payload correct
- 65 requests to `/api/search` from one IP → exactly 60×200 then 5×429, with
  `Retry-After: 46` and correct `X-RateLimit-*`; a second IP unaffected
- `npm run admin:promote` creates the row with `role=ADMIN, tier=TEAM`
- `npm run build`, `npx tsc --noEmit`, and ESLint all clean for new files
  (pre-existing lint errors in `prisma/seed.ts` and globe components untouched)

Test rows were removed from `dev.db` afterward.

### One issue found and fixed during testing

`/api/auth/session` was returning the raw database row — including
`sessionToken`, `stripeCustomerId`, `emailVerified`, and internal timestamps — to
the client. Under the database strategy Auth.js spreads the `Session` record onto
the object it hands the callback, so mutating and returning it leaks those
fields. The callback now rebuilds the session explicitly from named fields.

## Follow-ups

1. **Run `npm run migrate:turso:auth` against production Turso** before or
   immediately after deploying. Until then, sign-in will fail in production
   (no `User` table). Additive and re-runnable.
2. **Set `AUTH_SECRET` in Vercel** — Auth.js requires it in production.
3. **Provision Resend and/or Google** — with neither, `/signin` renders but no
   one can sign in.
4. **Promote the first admin** against production once the tables exist.
5. `/pricing` doesn't exist yet — `requireTier` redirects there on tier failure.
   Phase 5 builds it. No Phase 1 code path reaches it (nothing is tier-gated yet).
6. The rate limiter keys on `x-forwarded-for`, which is spoofable on hosts that
   don't normalize it. Vercel does, so this is fine as deployed; revisit if the
   app ever runs behind a different proxy.
7. Pre-existing lint errors (`prisma/seed.ts` `no-explicit-any`, a
   `react-hooks/immutability` error in the globe) are untouched and still fail
   `npm run lint`. Worth a cleanup pass, but out of scope here.

## Notes for Phase 2

- `User.alertEmailOptIn` already exists and is surfaced on `SessionUser`.
- `lib/api/response.ts` provides `ok`/`fail`/`parseQuery`/`parseBody` (zod 4) for
  the `{ data, error }` envelope the new routes should use.
- `apiRequireTier('PRO')` is ready for the Free-vs-Pro watchlist limits.
- Alert evaluation should hang off the existing `requireCronRequest`-guarded
  `/api/cron/daily-sync` and `weekly-sync` handlers, after their data refresh.
