# Phase 5 — Monetization, exports, credibility, and tests

Four of five parts shipped. **Stripe is deferred** — it needs account-level
provisioning I can't do from here. Details at the bottom.

Build and typecheck clean; 72 Vitest assertions green; exports, `/data`, and the
SEO pages verified at runtime.

## What shipped

### Vitest suite (`npm test`)

The spec named the two subsystems with the highest regression risk — the
alert-rule evaluators and the ATO↔entity matcher — and both now have permanent
tests. 72 assertions across three files, replacing the throwaway scripts from
Phases 2–4.

**Test isolation was the design problem.** `lib/db.ts` resolves its connection
from `TURSO_DATABASE_URL`, falling back to `file:dev.db` — so a naive test run
would mutate the development database, and with a populated `.env`, production.
`tests/global-setup.ts` provisions a disposable SQLite file and points that
variable at it *before* any test imports the Prisma client. Verified after the
fact: `dev.db` had zero test rows.

Coverage worth naming:

- **Matcher** — every "must not" case is a false positive the first
  implementation actually produced: `Salesforce` → `Salesforce Ventures`,
  `SAIC` → `SAIC Capital`, and the `alsoKnownAs` subsidiary inversions. The
  fixture is hand-built, so a regression fails the test rather than depending on
  what happens to be in the database.
- **Date parsing** — the `annual_assessment` recurrence, including the exact
  bug (`new Date("09/30")` → September 2001), plus `02/30`, month 13, Feb 29 in
  a non-leap year, and `"Continuous ATO"`. `now` is injected so the suite
  doesn't start failing in January.
- **Alert engine** (against the disposable DB) — idempotency via `dedupeKey`;
  the silent-baseline rule; and the ordering property that the change set is
  computed once per run so **two rules watching the same target both see the
  change**, which is the failure mode a per-rule diff would reintroduce.

### Exports

`lib/export/build.ts` drives CSV and XLSX from one sheet model, so the two
formats can't drift. Pro-gated at the route (`apiRequireTier('PRO')`); the UI
control only shapes the affordance.

Every export carries a provenance footer: timestamp, row count, attribution,
and the dataset's own caveats — that "Assessment due" is not an expiration, and
that a blank obligation figure means **unknown, not zero**. An exported
spreadsheet outlives the page it came from and gets forwarded without context,
so a figure that means "unknown" has to say so inside the file.

Row caps are surfaced in the footer rather than silently truncating.

### `/data`

Live coverage page. Every figure is a real query — entity/contract/authorization
counts, obligation totals, per-source sync freshness.

Two honesty mechanics: it reports **what fraction of contract records actually
carry a dollar figure**, because the headline total is meaningless without it;
and it reports how many authorizations are resolved to a tracked vendor, with
the pending review count, rather than implying full coverage.

**A build failure here was the most useful thing in this phase.** With
`revalidate = 3600`, Next prerendered the page at build time, which issued the
queries during `next build` — and it failed on
`no such column: FedrampAuthorization.entityId`, because the Phase 3 migration
hasn't been run against the database `.env` points at. That is not a page bug;
it means **a deploy would have failed for the same reason.** Two fixes:
`dynamic = 'force-dynamic'` so a deploy is never coupled to schema state, and
per-figure degradation so one missing column reports "unavailable" instead of
500ing a public page.

### SEO and ISR

- `app/vendor/[slug]` split into a server half (metadata, canonical, daily
  revalidation, OG image) and the existing client half. The dossier stays
  client-fetched so on-demand vendor builds still work and a cached shell can
  never serve stale compliance data.
- `/compliance/cso/[packageId]` — one indexable page per FedRAMP offering, with
  agency reuse and the assessment date, linked from every compliance row.
- Generated OG images carrying real figures (authorization count, highest impact
  level), falling back to a plain branded card if the lookup fails — an OG route
  that throws leaves crawlers with a broken image.

Descriptions are built from actual fields. No "leading provider of…" templates:
a page asserting positioning we have no data for is both thin content and untrue.

### Indexes and the JSON-column tradeoff

**`Contract` had no indexes at all** — despite being filtered by `entityId` on
the vendor dossier, the crosswalk, all six analyst tools, and every export, and
scanned by `createdAt` on every cron run. Added entityId, agencyId, createdAt,
value, sbirProgram; plus createdAt/publishedAt on `NewsItem`.

The JSON-column question the spec asked about is **documented in the schema and
deliberately not fixed**. `setAsides` and friends are filtered by substring match
on the serialized JSON, which is exact only because the values are quoted
enum-like tokens with no substring collisions. A join table is the correct fix;
it isn't done because the filter runs over ~2k entities against an
already-narrowed set and is not a measured bottleneck, while the migration would
touch syncVendor, the dossier, the crosswalk, the universe query, the analyst
tools, and the exports. The schema comment states the trigger for revisiting.

## Verified

- `npm test` — 72 assertions, 3 files. `dev.db` confirmed untouched afterward.
- Exports: Free → 403 naming the required tier; Pro → CSV with correct headers,
  real rows, and the footer; XLSX opens as a real workbook with all crosswalk
  sections and the same caveats.
- `/data` renders live figures (2,243 entities, 650 authorizations).
- Vendor page: title, description built from real data ("3 cloud authorizations
  on record (highest: IL5)"), canonical URL. OG image returns a 27KB PNG.
- CSO page 200s with correct metadata; an unknown package ID 404s.

## Stripe — deferred, and why

The repo is **not linked to a Vercel project**, and provisioning Stripe through
the Marketplace (`vercel link`, then `vercel integration add stripe`) requires
your account and a browser handshake. Provisioning first is the documented
sequence for this repo, and it is the right one here: it produces real
`STRIPE_SECRET_KEY` / webhook-secret env vars rather than hand-wired
placeholders I'd have to rip out.

I did complete the read-only half — `vercel integration discover --category
payments` confirms Stripe is the available (and recommended) provider, matching
the spec.

**What remains once provisioned:**

1. `Team` / `TeamMember` models (5 seats, shared watchlists).
2. `/api/billing/checkout` and `/api/billing/portal`.
3. `/api/billing/webhook` updating `User.tier` — signature-verified, idempotent
   on Stripe event id.
4. `/pricing` — currently referenced by the quota banner, tier-limit copy, and
   the Pro-gated export control, all of which link to a page that does not exist.

The tier machinery it plugs into is already built and tested: `User.tier`,
`User.stripeCustomerId`, `tierAtLeast`, `apiRequireTier`, and
`checkAnalystQuota` all exist and are exercised.

## Follow-ups

1. **Production migrations — still none run.** Ordered by dependency:
   ```
   npm run migrate:turso:auth
   npm run migrate:turso:alerts
   npm run migrate:turso:compliance
   npm run backfill:ato-entities
   npm run migrate:turso:analyst
   npm run migrate:turso:indexes
   ```
   The `/data` build failure is direct evidence the target database is behind.
2. **Re-sync FedRAMP after migrating** so the assessment-date fix reaches
   existing rows.
3. **`/pricing` does not exist** and four surfaces link to it.
4. **No visual QA** on `/data`, `/compliance`, `/analyst`, or the CSO pages.
   They typecheck, build, and their data layers are tested, but I have not
   opened any of them in a browser.
5. **No `sitemap.xml` or `robots.txt`.** The SEO pages are indexable but nothing
   advertises them; a generated sitemap over vendors and CSO package IDs is the
   obvious next step.
6. **Export row cap is 5000.** Surfaced in the footer, but a genuinely large
   export needs streaming rather than a bigger number.
7. **Analyst live path still unverified** at the time of writing — see
   `docs/PHASE-4.md`.
