# Iron Echelon — Defense Tech Intelligence

Live at **[intel.ironechelon.com](https://intel.ironechelon.com)**.

An OSINT platform mapping the defense technology, cybersecurity, AI, and
surveillance ecosystem: who builds what, who funds them, which agencies buy from
them, and which of their systems are actually authorized to run on government
networks.

The differentiating dataset is **compliance intelligence** — FedRAMP
authorizations, DoD Impact Level provisional authorizations, and eMASS system
ATOs — fused with federal contract obligations and private funding flows.

---

## Architecture

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19, Turbopack |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS 4, terminal/OSINT dark theme (`app/globals.css`) |
| ORM | Prisma 7 with the `prisma-client` generator → `app/generated/prisma` |
| Database | Turso / LibSQL in production, local SQLite file in dev |
| Auth | Auth.js (NextAuth v5) — Resend magic link + Google OAuth, database sessions |
| Visualization | three.js + react-three-fiber (globe), d3-sankey (network) |
| Hosting | Vercel, with cron-triggered sync routes |

### Directory map

```
app/
  api/
    admin/*        Privileged sync + import endpoints (see Auth below)
    ato/*          FedRAMP / DoD PA / eMASS query endpoints
    auth/*         Auth.js route handler
    cron/*         daily-sync, weekly-sync (Vercel Cron)
    sync/*         Seed + refresh routes for each data source
    entities, connections, contracts, sbir, search, stats, vendors, vendor/[slug]
  map/             three.js globe view
  network/         d3-sankey relationship graph
  funders/         Investor / funding view
  contracts/       Federal contract browser
  vendors/         Vendor directory
  vendor/[slug]/   Per-vendor dossier
  ato/             ATO intelligence dashboard
  compliance/      Authorized-cloud universe (ATO <-> contract crosswalk)
  analyst/         Claude-powered defense-market analyst (streaming chat)
  data/            Public live coverage statistics
  compliance/cso/[packageId]/  Per-offering SEO landing page
  intel/           RSS feed aggregator
  admin/           Operator panel (ADMIN role required)
  signin/          Auth.js sign-in
components/
  globe/  layout/  panels/  views/
lib/
  auth.ts          Auth.js config + requireUser / requireTier guards
  admin-auth.ts    Unified privileged-route auth
  rate-limit.ts    LibSQL-backed fixed-window limiter
  api/response.ts  { data, error } envelope + zod parse helpers
  clients/         External API clients (SAM, USASpending, SBIR, Apollo, agencies)
  ingest/          Source-specific ingest (DISA, FedRAMP, vendor universe)
  match/           Entity name resolution + alias table + ATO->Entity matcher
  compliance/      Crosswalk, universe query, derived insights
  ai/              Analyst engine, tool surface, quota
  export/          CSV/XLSX builder with provenance footer
  coverage.ts      Live /data statistics
  seo.ts           Metadata builders for programmatic pages
  vendor/          Dossier assembly, enrichment, relevance scoring
prisma/
  schema.prisma    Single schema
  migrate-turso-*.ts  Hand-rolled additive DDL for production Turso
scripts/
  promote-admin.ts Grant/revoke the ADMIN role
```

### Data model

Core: `Entity` (companies, agencies, investors — with cached vendor-intel fields
like `businessSize`, `setAsides`, `riskFlags`, `agencyBreakdown`), `Connection`,
`Contract` (including SBIR/STTR fields), `FundingRound`, `NewsItem`, `Country`,
`Submission`.

Authorizations: `FedrampAuthorization`, `DodProvisionalAuth`, `EmassAuthorization`,
`AtoCompany`, `AtoAlert`, `AtoSyncLog`.

Supporting: `FederalContract`, `SamRegistration`, `LobbyingFiling`.

Accounts: `User`, `Account`, `Session`, `VerificationToken`, `RateLimit`.

Alerting: `Watchlist`, `WatchlistItem`, `AlertRule`, `AlertEvent`,
`AlertSnapshot`.

Compliance: `entityId` on all three ATO models, plus `AtoMatchReview` for names
the matcher wouldn't auto-link.

Analyst: `AnalystThread`, `AnalystMessage`.

Several columns hold JSON-encoded arrays (`riskFlags`, `setAsides`,
`agencyBreakdown`, `naicsCodes`, `sources`) — a deliberate tradeoff for SQLite.
They are read-mostly and parsed in the API layer, not filtered in SQL.

---

## Data sources

| Source | Endpoint | Ingest |
|---|---|---|
| FedRAMP Marketplace | `GSA/marketplace-fedramp-gov-data` on GitHub | `lib/ingest/fedramp.ts`, daily cron |
| DISA DCAS | `dl.dod.cyber.mil` authorized-CSO XLSX | `lib/ingest/disa.ts`, daily cron |
| eMASS | Manual CSV upload | `/admin` → import, `/api/admin/import/emass` |
| USASpending | `api.usaspending.gov/api/v2` | `lib/clients/usaspending.ts` |
| SBIR/STTR | `api.www.sbir.gov/public/api/awards` | `lib/clients/sbir.ts` |
| SAM.gov | `api.sam.gov/entity-information/v3` | `lib/clients/sam.ts` (needs `SAM_SECRET`) |
| Senate LDA | `lda.senate.gov/api` | `/api/sync/seed-lobbying` |
| Apollo.io | MCP session-bound; payload POSTed in | `/api/admin/vendor/[slug]/apollo` |
| Surveillance Watch | `surveillancewatch.io/api/v1` | `lib/api/surveillance-watch.ts`, daily cron |
| Security RSS | ~20 feeds | `/api/intel-feeds` (fetched live, not stored) |

---

## Local development

```bash
npm install
cp .env.example .env          # then fill in what you need

# IMPORTANT: TURSO_DATABASE_URL takes precedence over DATABASE_URL in both
# lib/db.ts and prisma.config.ts. If it is set, local runs hit PRODUCTION.
# Blank it out to work against dev.db:
TURSO_DATABASE_URL= TURSO_AUTH_TOKEN= npm run dev
```

Applying schema changes locally — always pass `--url` so a stray env var can't
retarget the push at production:

```bash
npx prisma db push --url="file:./dev.db"
```

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | `prisma generate` + `next build` |
| `npm run lint` | ESLint |
| `npm test` | Vitest suite (disposable DB, never touches dev.db) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run seed` | Seed base entities |
| `npm run seed:sbir` | Seed SBIR/STTR awards |
| `npm run admin:promote -- <email>` | Grant ADMIN (creates the user if absent); `--demote` to revoke |
| `npm run migrate:turso:auth` | Apply the auth + rate-limit tables to production Turso |
| `npm run migrate:turso:alerts` | Apply the watchlist + alert tables to production Turso |
| `npm run migrate:turso:compliance` | Apply the ATO entityId columns + match-review table |
| `npm run migrate:turso:analyst` | Apply the analyst thread tables to production Turso |
| `npm run migrate:turso:indexes` | Apply the Phase 5 query indexes to production Turso |
| `npm run backfill:ato-entities` | Link ATO rows to entities; `--dry` to preview, `--all` to re-evaluate |

---

## Auth and access control

**User-facing.** Auth.js v5 with two optional providers — Resend magic link and
Google OAuth. Each is enabled only when its env vars are present, so a
deployment with neither still builds and runs; `/signin` says so plainly.
Sessions are database-backed rather than JWT, so a tier or role change takes
effect on the next request.

Guards live in `lib/auth.ts`:

```ts
// Server components — redirect on failure
const user  = await requireUser('/watchlists')
const pro   = await requireTier('PRO')
const admin = await requireAdminUser()

// Route handlers — return a response on failure
const guard = await apiRequireTier('PRO')
if (!guard.ok) return guard.response
guard.user // typed SessionUser
```

Tiers rank `FREE < PRO < TEAM`, so a `TEAM` user passes a `PRO` check.

**Privileged routes.** `lib/admin-auth.ts` is the single entry point for
`/api/admin/*` and `/api/sync/*`. It accepts any of:

1. `Authorization: Bearer <SYNC_API_KEY | ADMIN_SECRET>`
2. `x-cron-secret` / `?secret=` matching `CRON_SECRET` (legacy seed routes only)
3. A signed-in session with `role = ADMIN`

Vercel Cron routes (`/api/cron/*`, `/api/sync/surveillance-watch`) use
`requireCronRequest` and accept only `Bearer $CRON_SECRET`.

> **Hardening note:** these routes previously allowed *anyone* when no secret was
> configured. That fallback now applies only outside production — in production,
> unconfigured secrets deny.

**Bootstrapping the first admin:**

```bash
npm run admin:promote -- you@example.com
```

This creates the user row if it doesn't exist, so `/admin` is reachable before
any provider is wired up. Signing in with that exact address claims the account.

**Rate limiting.** `lib/rate-limit.ts` — a LibSQL-backed fixed window, no extra
infrastructure. The window index is part of the key, so one upsert both creates
and increments the counter. Applied to `/api/search` (60/min), `/api/entities`
(120/min), `/api/vendors` and `/api/vendor/[slug]` (60/min), plus a tighter
5-per-5-minutes budget on the on-demand vendor enrichment path, which calls
external APIs. Responses carry `X-RateLimit-*`; 429s carry `Retry-After`. It
fails **open** — a database problem shouldn't take the public API down.

---

## Environment variables

See `.env.example` for the annotated list. The essentials:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | dev | Local SQLite path |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | prod | Turso connection |
| `AUTH_SECRET` | prod | Auth.js encryption — `openssl rand -base64 32` |
| `RESEND_API_KEY` / `EMAIL_FROM` | optional | Magic-link sign-in |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | Google sign-in |
| `SYNC_API_KEY` / `ADMIN_SECRET` | prod | Machine access to admin routes |
| `CRON_SECRET` | prod | Vercel Cron authentication |
| `SAM_SECRET` | optional | SAM.gov entity lookups |

---

## Deployment (Vercel + Turso)

1. **Database.** Create a Turso database; set `TURSO_DATABASE_URL` and
   `TURSO_AUTH_TOKEN` in Vercel.
2. **Schema.** Turso is migrated with explicit additive DDL scripts rather than
   `prisma migrate` — `prisma/migrate-turso*.ts`. For the Phase 1 tables:
   ```bash
   npm run migrate:turso:auth
   ```
   Every statement is `IF NOT EXISTS`, so re-running is safe.
3. **Auth.** Set `AUTH_SECRET`. For Google, add
   `https://<domain>/api/auth/callback/google` as an authorized redirect URI.
   For Resend, verify the sending domain and set `EMAIL_FROM` to match.
4. **Secrets.** Set `CRON_SECRET` and `SYNC_API_KEY`. Vercel Cron sends
   `CRON_SECRET` automatically as a bearer token.
5. **Deploy.** Push to `main`. Build runs `prisma generate && next build`.
6. **First admin.** `npm run admin:promote -- you@example.com` with the
   production Turso vars in your environment.

### Cron schedule (`vercel.json`)

| Path | Schedule | Does |
|---|---|---|
| `/api/sync/surveillance-watch` | `0 6 * * *` | Entity/connection refresh |
| `/api/cron/daily-sync` | `0 6 * * *` | FedRAMP + DISA ingest, then REALTIME/DAILY alert rules + daily digest |
| `/api/cron/weekly-sync` | `0 7 * * 1` | Rotating vendor re-enrichment, then WEEKLY alert rules + weekly digest |

---

## Watchlists and alerts

Users track targets (vendors, FedRAMP offerings, agencies, keywords, NAICS codes)
on watchlists and attach alert rules to them. Rules are evaluated inside the
existing cron routes after their data refresh — there is no separate alerting
cron.

| Rule type | Fires when |
|---|---|
| `NEW_CONTRACT` | A watched entity/agency/NAICS gets a new award or federal obligation |
| `NEW_SBIR_AWARD` | A new SBIR/STTR award matches an entity, keyword, or agency |
| `FEDRAMP_STATUS_CHANGE` | A watched offering's status or impact level moves |
| `ATO_EXPIRING` | FedRAMP/DoD PA/eMASS expiry crosses 90/60/30/14/7 days |
| `RISK_FLAG_ADDED` | A watched entity gains a risk flag |
| `NEWS_MENTION` | A watched entity is linked to a newly ingested news item |

New-row rules use a 7-day lookback with a unique `dedupeKey`, so a missed run
self-heals without duplicating alerts. Change-detection rules diff against
`AlertSnapshot` baselines, computed once per run before any rule evaluates —
a first-seen key is recorded silently so a fresh deploy doesn't report the whole
universe as changed.

Tiers: Free gets 1 watchlist, 5 targets, weekly digest. Pro/Team get unlimited
lists and targets plus daily and in-app alerts. "Realtime" means in-app on the
next cron evaluation with no email batching — not sub-minute delivery.

Email goes out through Resend. Without `RESEND_API_KEY` the in-app inbox still
fills; digests skip with a logged reason.

---

## Compliance intelligence

The differentiating module: FedRAMP, DoD provisional, and eMASS authorizations
joined to federal contract obligations, so you can ask who is cleared to operate,
at what impact level, for which agency — and whether they are winning work there.

`lib/match/ato-entity.ts` resolves feed vendor names to `Entity` rows and writes
`entityId` onto each authorization. It is deliberately conservative: fuzzy
strategies skip investor and government entities, prefix matching only accepts a
feed name *more* specific than the entity name, and anything ambiguous goes to
the `/admin` review queue rather than being guessed. A wrong link would attribute
another company's contracts to a vendor.

**On dates:** FedRAMP authorizations do not hard-expire. The feed publishes
`annual_assessment` as a month/day recurrence (`"09/30"`), which is the
anniversary the assessment is due; an authorization lapses if it isn't met. The
UI calls this "assessment due", never "expiration".

---

## AI analyst

`/analyst` is a Claude-powered defense-market analyst. It answers only from Iron
Echelon's own data through six tools that wrap existing internal query functions
(`lib/ai/tools.ts`) — **the model never writes SQL and has no free-text query
path into the database**; every tool takes typed parameters mapping onto a fixed
Prisma query.

Two conventions make the answers trustworthy. Every tool result names its
`dataset` so the model can cite provenance. And absent data comes back as an
explicit null plus an availability flag, never a zero — `totalFederalObligated`
is null until enrichment runs, and a model reading that as "$0" would state that
a major prime has never won federal work.

Model defaults to `claude-sonnet-5`; override with `ANTHROPIC_MODEL`. Without
`ANTHROPIC_API_KEY` the page renders and says the analyst is unconfigured.
Pro/Team are unlimited; Free gets 5 messages/day, metered through the same
LibSQL fixed-window limiter as the public API.

**On spend:** `Entity.totalFederalObligated` is a cache written by `syncVendor`.
For an un-enriched vendor it is null, meaning *unknown*, not zero — so the
"whitespace" insight (authorized but winning nothing) only counts vendors whose
enrichment has actually run, and the crosswalk exposes `spendDataAvailable` to
keep the distinction visible.

---

## API conventions

Routes added from Phase 1 onward use zod-validated input and a consistent
envelope via `lib/api/response.ts`:

```json
{ "data": {}, "error": null }
{ "data": null, "error": "message" }
```

Pre-existing public routes keep their original response shapes — they have
shipped clients and are not to be broken.

---

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Auth, users, rate limiting, hardening | shipped |
| 2 | Watchlists + alert engine | shipped |
| 3 | ATO ↔ contract crosswalk, `/compliance` | shipped |
| 4 | AI analyst (Claude tool use) | shipped |
| 5 | Exports, `/data`, SEO/ISR, test suite | shipped |
| 5b | Stripe billing | deferred — needs Vercel Marketplace provisioning |

Per-phase notes live in `docs/`; a condensed history is in `CHANGELOG.md`.

---

## Testing

```bash
npm test
```

Vitest, covering the two subsystems with the highest regression risk: the
ATO↔entity matcher and the alert-rule evaluators.

`tests/global-setup.ts` provisions a **disposable** SQLite database and points
`TURSO_DATABASE_URL` at it before any test imports the Prisma client. That
matters: `lib/db.ts` falls back to `file:dev.db`, so without it a test run would
mutate the development database — and with a populated `.env`, production.

The matcher tests build their fixture by hand rather than reading the database,
so they pin behaviour rather than tracking whatever data happens to be present.
Every "must not match" case is a false positive an earlier implementation
actually produced.

---

## Exports

CSV and XLSX exports on `/compliance`, `/contracts`, and per-vendor crosswalks,
gated to Pro at the route. Both formats are driven from one sheet model so they
cannot drift.

Every file carries a provenance footer — generation timestamp, row count,
attribution, and the dataset's own caveats. A spreadsheet outlives the page it
came from and gets forwarded without context, so a blank obligation figure says
in the file that it means *unknown*, not zero.
