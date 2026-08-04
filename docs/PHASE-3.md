# Phase 3 — ATO ↔ Contract Crosswalk

Shipped. Build and typecheck clean; 38 assertions verified at runtime plus the
15 Phase 2 engine tests re-run green after the FK switch.

This is the differentiating module: joining "who is authorized to operate" to
"who is actually winning work," which neither FedRAMP Marketplace nor USASpending
can answer alone because neither knows about the other.

## What shipped

### Entity resolution (`lib/match/ato-entity.ts`)

`entityId` FKs added to `FedrampAuthorization`, `DodProvisionalAuth`, and
`EmassAuthorization`, resolved by a scored matcher: exact-normalized (1.0) →
curated alias (0.95) → alsoKnownAs (0.7) → slug (0.9) → token-prefix (0.85) →
token-overlap (≤0.79, suggestions only). Auto-match threshold is 0.8, and a tie
at the top counts as ambiguous and goes to review rather than picking one.

**Result on real data: 642/650 FedRAMP rows and 10/19 DoD PA rows linked, with
7 names in the review queue.** A dry-run mode (`--dry`) reports without writing.

**The matcher's first version was wrong, and the failures were instructive.**
Auditing every non-exact match surfaced two false-positive classes:

1. **Investor arms.** The entity set contains "Amazon Alexa Fund", "Salesforce
   Ventures", "SAIC Capital", "Mosaic Ventures" — but no bare "Amazon",
   "Salesforce", or "SAIC". An unconstrained prefix match happily attributed
   AWS's authorizations to Amazon's venture arm.
2. **`alsoKnownAs` means parent company, not alias.** Ring's aka is
   `["Amazon"]`, Data Grand's is `["Microsoft"]`. A reverse lookup inverts the
   relationship and links a CSP to its own subsidiary.

Three fixes: fuzzy strategies skip `INVESTOR`/`GOVERNMENT` entities entirely;
token-prefix runs in one direction only (the feed name may be *more* specific
than the entity — "Palantir Gotham Federal Cloud" → "Palantir" — but never the
reverse); and `alsoKnownAs` is demoted below the auto-match threshold so it
informs review instead of deciding. False positives went to zero with no loss of
legitimate matches.

The governing principle: **a wrong link is worse than no link.** It would
attribute another company's contracts and risk flags to a vendor on a page an
acquisition officer might act on.

### Review queue

`AtoMatchReview` aggregates unresolved names (one row per name, not per
authorization) with the near-misses that were deliberately *not* applied.
Surfaced in `/admin` with three actions:

- **LINK** to a suggested entity
- **CREATE VENDOR** — the practical resolution for the big CSPs, since the feed
  names companies we simply don't track yet
- **IGNORE** — and the backfill deliberately never resets an ignored status

Resolving one name links every row carrying it. Verified end-to-end: creating
"Amazon Web Services" linked 3 DoD PA rows and its crosswalk immediately
returned AWS GovCloud at IL2/IL4/IL5.

### Two ingest bugs found and fixed

Building the expiry features surfaced that **zero FedRAMP rows had an
expiration date** — silently disabling `/api/ato/expiring`, the Phase 2
`ATO_EXPIRING` alert rule, the compliance expiry filter, and the expiring-by-agency
insight. Two compounding causes:

1. **Divergent duplicate mappings.** `lib/ingest/fedramp.ts` hardcoded
   `expirationDate: null`, while `cron/daily-sync` carried its own copy of the
   field mapping that read `annual_assessment`. Whichever path last wrote a row
   decided whether expiry data existed. Fixed by deleting the cron's inline
   mapping and delegating to the shared module — one mapping, one place. The
   route lost ~80 lines.

2. **`annual_assessment` is a month/day recurrence, not a date.** Values are
   `"09/30"`, `"12/1"` — the annual assessment anniversary. `new Date("09/30")`
   yields **September 2001**, so the "correct" mapping would have filled the
   column with two-decade-old dates that look real to every consumer.
   `parseAnnualAssessment` now parses the recurrence and returns the next
   occurrence, handling the ISO-datetime minority, single-digit days, impossible
   dates (`02/30`), and Feb 29 in a non-leap year.

After the fix: 520 rows carry assessment dates, 518 in the future, **251 due
within 180 days**, distributed across 2026/2027 as the recurrence rolls forward.

**Naming matters here:** FedRAMP authorizations don't hard-expire. Continuous
monitoring means an authorization lapses if the annual assessment isn't met, so
the UI labels this "assessment due", not "expiration".

While in the feed, two more fields were captured that it publishes and we were
ignoring: **`uei`** (275 rows — a strong matching key) and **`small_business`**
(229 rows). The latter matters because `Entity.businessSize` requires vendor
enrichment, which has run for exactly 1 entity — the small-business filter and
insight would otherwise have been empty for the entire universe.

### A whitespace bug that would have embarrassed the product

The crosswalk initially reported Palantir as **whitespace** — "authorized but has
never won federal work" — while showing 20 contracts. `totalFederalObligated` is
a cache written by `syncVendor`; for an unenriched vendor it's null, meaning
*unknown*, not zero. Treating null as zero would have listed primes with billions
in obligations as having won nothing, on the flagship insight card.

Whitespace now requires `vendorSyncedAt !== null`, and the crosswalk exposes
`spendDataAvailable` so the UI distinguishes "zero" from "unknown". The
`/compliance` card says so explicitly when the list is empty for this reason.

### APIs

```
GET /api/compliance/crosswalk?entity=slug   unified vendor compliance + spend
GET /api/compliance?...                     filterable universe table + facets
GET /api/compliance/insights                the four derived insights
GET/POST /api/admin/ato-matches             review queue (admin-guarded)
```

Filters: search, impact level, status, agency, business size, set-aside,
assessment-due window, source, sort. Facet values come from the database, so the
UI only offers options that return results.

### `/compliance` page

Stat strip, four insight cards, filter bar, and the authorization table (vendor,
offering, level, status, agencies leveraging, federal $, assessment due, flags).
Every row links to its vendor page; unlinked rows render as plain text rather
than a dead link.

### Vendor page

`CompliancePosture` replaces the dossier's flat authorization list — same source
data plus the timeline, assessment countdowns, and the agency leverage map, which
tags each agency as SPONSOR / LEVERAGING / BUYS. The gap between "sponsors" and
"buys" is the call-worthy signal. Rows matched by name rather than FK are marked
`~` so a provisional link never reads as confirmed.

### Phase 2 follow-up closed

The alert evaluators now match ATO rows by `entityId`, falling back to the name
path only for rows the matcher declined to link. All 15 Phase 2 engine tests
re-run green.

## Verified

**Matcher (12 assertions):** no CSP auto-links to an investor arm (Salesforce,
SAIC, Mosaic, Data probes); `alsoKnownAs` subsidiaries stay below threshold but
still appear as review suggestions; "Palantir Gotham Federal Cloud" → Palantir at
≥ threshold; unknown and empty names yield nothing.

**Date parsing (11 assertions):** recurrence rolls to next year once passed;
single-digit days; ISO passthrough; `""`, null, `"Continuous ATO"`, `02/30`,
month 13, and garbage all → null; Feb 29 in a non-leap year → null rather than
silently becoming Mar 1.

**Backfill:** 642/650 linked, idempotent on re-run (`linked=0 unchanged=642`).

**APIs:** universe returns 650 with working facets; `expiringWithinDays=90`
returns 141; `businessSize=SMALL` returns 229; search+SMALL together returns 48 —
this last one caught a bug in my own edit, where `filters.search` and the
small-business filter both emitted an `OR` key and the second silently clobbered
the first, dropping the search term. Now combined under `AND`.

**Pages:** `/compliance`, `/vendor/[slug]`, `/ato`, `/vendors` all 200; `/admin`
307s to sign-in when signed out.

Test data removed from `dev.db`; the review queue is back to 7 pending.

## Follow-ups

1. **Production migration order** — all three are still outstanding and are
   ordered by FK dependency:
   ```
   npm run migrate:turso:auth        # Phase 1
   npm run migrate:turso:alerts      # Phase 2 (needs User)
   npm run migrate:turso:compliance  # Phase 3
   npm run backfill:ato-entities     # after the above
   ```
   The compliance script adds columns, so it checks `PRAGMA table_info` first
   rather than relying on `IF NOT EXISTS`, which SQLite doesn't support for
   columns.

2. **Re-sync FedRAMP after deploying**, or the assessment-date fix won't reach
   existing production rows — the mapping only applies on write. `POST
   /api/admin/sync/fedramp` or wait for the daily cron.

3. **Whitespace stays empty until vendor enrichment runs more widely.** Only 3
   entities are enriched locally. This is correct behaviour, not a bug, but the
   headline insight is thin until `weekly-sync` has rotated through the universe.

4. **eMASS is entirely untested against real data** — the table is empty locally
   and the matcher path for it is exercised only by code review. `cloudProvider`
   is often null there, and the `systemName` fallback usually names a program
   rather than a company, so expect most eMASS rows to land in review.

5. **`/compliance` merges and paginates in memory** (documented in
   `universe.ts`). Fine at ~650 rows; wants a denormalized table or materialized
   view past tens of thousands.

6. **Set-aside filtering is a substring match on a JSON TEXT column.** Exact in
   practice because the values are quoted enum tokens, but a join table is the
   right fix — deferred to the Phase 5 tech-debt pass as planned.

7. **No visual QA was done on `/compliance`.** It typechecks, builds, and its
   data layer is well covered, but I did not open it in a browser.

8. Still no `/pricing`, and the Phase 5 Vitest suite is still the plan of record
   for making these assertions permanent — the matcher and date parser are now
   the highest-value targets for it, alongside the alert evaluators.

## Notes for Phase 4

- `buildCrosswalk(slug)` is exactly the `get_entity_profile` tool the AI analyst
  spec calls for — it returns one unified JSON with authorizations, spend, SBIR,
  set-asides, and risk flags.
- `queryUniverse` and `buildInsights` map cleanly onto `list_authorizations`.
- Tool wrappers should surface `spendDataAvailable` and `matchedByName` so the
  model can say "unknown" instead of asserting zero, and "provisional match"
  instead of asserting a link. The system prompt's "refuse to fabricate" rule
  depends on those flags reaching it.
