# Changelog

All notable changes to Iron Echelon. Newest first.

## Phase 5 — Monetization, exports, credibility, and tests

### Added
- **Vitest suite** (`npm test`) covering the two highest-regression-risk
  subsystems: the ATO↔entity matcher and the alert-rule evaluators. Runs against
  a disposable SQLite database provisioned per run, never `dev.db`.
- **Pro-gated CSV/XLSX exports** on `/compliance`, `/contracts`, and per-vendor
  crosswalks. Every file carries a provenance footer — generation timestamp, row
  count, attribution, and the data's own caveats.
- **`/data`** — public coverage page. Every figure queried live; partial coverage
  and unavailable figures say so instead of showing a zero.
- **SEO landing pages** — per-vendor metadata, canonical URLs, and generated OG
  images; new `/compliance/cso/[packageId]` page per FedRAMP offering. Both
  revalidate daily.
- Indexes on `Contract` (entityId, agencyId, createdAt, value, sbirProgram) and
  `NewsItem` (createdAt, publishedAt).

### Changed
- `/data` renders per request rather than prerendering at build. Build-time
  prerendering coupled every deploy to the database schema being current — a
  pending migration failed the build outright.
- Coverage queries degrade per figure instead of failing the page.

### Fixed
- `Contract` had **no indexes at all** despite being filtered by `entityId` on
  the dossier, crosswalk, analyst tools, and every export.

### Deferred
- Stripe billing — the Marketplace integration requires account-level
  provisioning that could not be completed from here. See `docs/PHASE-5.md`.

---

## Phase 4 — AI analyst

### Added
- **`/analyst`** — Claude-powered defense-market analyst with streaming chat,
  persisted threads, and inline tool-call display.
- Six tools wrapping existing internal query functions. The model never writes
  SQL and has no free-text query path into the database.
- "Ask the analyst" deep-links from the vendor dossier and compliance rows,
  pre-seeding vendor context into the system prompt.
- `peekRateLimit` — read-only limiter check, so rendering a remaining-message
  count doesn't consume one.

### Changed
- Default model is `claude-sonnet-5` (spec named `claude-sonnet-4-6`; the
  successor is materially stronger at tool calling at the same tier).
  `ANTHROPIC_MODEL` overrides.

### Notes
- Tool results carry a `dataset` field for citation, and report absent data as
  an explicit null plus an availability flag — never as zero.

---

## Phase 3 — ATO ↔ contract crosswalk

### Added
- `entityId` FKs on all three ATO models, resolved by a scored matcher with an
  auto-match threshold and an `/admin` review queue for everything below it.
- **`/compliance`** — filterable authorized-cloud universe with four derived
  insight cards.
- Compliance Posture panel on the vendor dossier: authorization timeline,
  assessment countdowns, agency leverage map.
- `uei` and `smallBusiness` captured from the FedRAMP feed.

### Fixed
- **FedRAMP expiration dates were entirely absent.** Two causes: the shared
  ingest hardcoded `expirationDate: null` while the cron carried a divergent
  copy of the mapping, and `annual_assessment` is a month/day recurrence
  (`"09/30"`) that `new Date()` turned into September 2001. Both fixed; the cron
  now delegates to the shared module.
- Whitespace false positive — an unenriched vendor's null spend cache was read
  as "$0 in federal contracts".
- Matcher linked cloud providers to venture arms (`Salesforce` →
  `Salesforce Ventures`) and to their own subsidiaries via `alsoKnownAs`.

---

## Phase 2 — Watchlists and alert engine

### Added
- Watchlists over vendors, FedRAMP offerings, agencies, keywords, and NAICS codes.
- Six alert rule types evaluated inside the existing cron routes.
- Resend email digests with a terminal-themed template; `/alerts` inbox with an
  unread nav badge; `/account` opt-out.

### Notes
- Change-detection rules diff against `AlertSnapshot` baselines computed once
  per run, before any rule evaluates. First sight of a key is recorded silently.
- Tier is re-checked at send time, so a downgrade stops daily mail immediately.

---

## Phase 1 — Auth, users, and hardening

### Added
- Auth.js v5 with Resend magic link and Google OAuth, database sessions.
- `lib/admin-auth.ts` unifying privileged-route auth across 20 handlers.
- LibSQL-backed rate limiting on public API routes.

### Changed
- Privileged routes previously allowed anyone when their secret env var was
  unset. That fallback now applies only outside production.

### Fixed
- `/api/auth/session` leaked the raw database row — including `sessionToken` and
  `stripeCustomerId` — to the client.
