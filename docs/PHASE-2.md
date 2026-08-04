# Phase 2 — Watchlists & Alert Engine

Shipped. Build and typecheck clean; 24 engine/digest assertions and 31 HTTP
checks verified at runtime against local `dev.db`.

## What shipped

### Schema (additive only)

| Model | Purpose |
|---|---|
| `Watchlist` | Named list owned by a user |
| `WatchlistItem` | `ENTITY \| FEDRAMP_CSO \| AGENCY \| KEYWORD \| NAICS` target |
| `AlertRule` | Rule type + channel + frequency, bound to a watchlist |
| `AlertEvent` | A fired alert; `dedupeKey` unique |
| `AlertSnapshot` | Last-seen values for change detection |

`WatchlistItem` carries a `targetKey` alongside `targetId`/`targetValue`. It
exists purely so the uniqueness constraint has one non-null column to hang off —
`(watchlistId, targetType, targetKey)` is what stops the same vendor being added
twice. Free-text targets (KEYWORD, AGENCY) are case-folded into it, so
"Palantir" and "palantir" are one item.

Local: `npx prisma db push --url="file:./dev.db"`.
Production: `npm run migrate:turso:alerts` — **not yet run.**

### Two detection strategies

The interesting design problem: the cron overwrites source rows in place, so by
the time evaluation runs, "what changed" is unanswerable from the rows alone.

**New-row rules** (`NEW_CONTRACT`, `NEW_SBIR_AWARD`, `NEWS_MENTION`) query by
`createdAt` over a 7-day lookback — deliberately wider than the daily cadence so
a skipped or failed run self-heals. The unique `dedupeKey` makes the overlap a
no-op rather than a duplicate storm.

**Change rules** (`FEDRAMP_STATUS_CHANGE`, `RISK_FLAG_ADDED`) diff against
`AlertSnapshot` baselines. Three things matter here:

1. **First sight is silent.** A key with no stored baseline is recorded and
   produces no event. Without this, the first run after deploy would report the
   entire watched universe as having "changed".
2. **The diff is computed once per run, before any rule evaluates.** Doing it
   per-rule would be wrong, not just slow: the first rule to evaluate would
   advance the baseline, and every later rule watching the same target would see
   nothing. This is the single most important ordering constraint in the engine.
3. **Scoped to what someone actually watches.** Cost tracks subscriber interest,
   not universe size.

`RISK_FLAG_ADDED` only fires on additions — a flag clearing is good news, not an
alert.

`ATO_EXPIRING` uses threshold buckets (90/60/30/14/7 days) in the dedupe key, so
users get escalating notice instead of the same alert every single day.

`NEW_CONTRACT` excludes rows with `sbirProgram` set, so an SBIR award doesn't
fire both it and `NEW_SBIR_AWARD`.

### Entity ↔ ATO matching is currently by name

The ATO tables have no `entityId` FK yet, so an ENTITY target matches FedRAMP and
eMASS rows through `normalizeVendorName`. **Phase 3 replaces this with real FKs**
and the matching in `evaluators.ts` should be switched over then — it's the
weakest link in the current implementation and will miss vendors whose legal name
differs from their CSP name.

### Delivery

Resend, with a hand-written inline-CSS template duplicating the site's terminal
palette (mail clients strip `<style>` blocks and have no CSS variables). HTML
plus a plain-text alternative; all interpolated content is escaped and relative
URLs are absolutized so links work from a mail client.

Digests batch per user, capped at 40 events each — overflow rides along in the
next digest rather than being dropped. Only the batch that actually shipped is
marked `emailedAt`.

**Tier is re-checked at send time, not just at rule creation.** A user who
downgrades from Pro shouldn't keep receiving daily mail from rules created while
they were paying. Verified: the event stays unemailed rather than being silently
consumed, so it still surfaces in the weekly digest they are entitled to.

Opt-out (`User.alertEmailOptIn = false`) marks events handled so they can't
accumulate forever; they remain in the in-app inbox.

### Tier limits

| | Free | Pro / Team |
|---|---|---|
| Watchlists | 1 | unlimited |
| Items per list | 5 | unlimited |
| Frequencies | WEEKLY | REALTIME, DAILY, WEEKLY |

Enforced in `lib/alerts/watchlists.ts` so the limit can't drift between the
explicit create path and the one-click WATCH path. Re-adding an item that is
already on a full list is allowed — it isn't a new item, and refusing it would be
a confusing false positive.

**On "REALTIME":** there is no streaming ingest. REALTIME means *in-app on the
next cron evaluation, with no email batching* — practically, same-day. It is not
sub-minute delivery and the UI shouldn't imply otherwise.

### API

All new routes use zod validation and the `{ data, error }` envelope.

```
GET/POST         /api/watchlists
PATCH/DELETE     /api/watchlists/[id]
POST/DELETE      /api/watchlists/[id]/items
GET/POST/DELETE  /api/watchlists/watch      one-click toggle
GET/PATCH/DELETE /api/alerts                inbox, mark read, dismiss
GET              /api/alerts/unread         nav badge
GET/POST         /api/alerts/rules
PATCH/DELETE     /api/alerts/rules/[id]
GET/PATCH        /api/account               alertEmailOptIn
```

Every mutation is scoped by `userId` in the `where` clause — not checked and then
mutated — so another user's id is a 404 or a zero-count no-op, never a
cross-tenant write.

`/api/alerts/unread` returns `{ unreadCount: 0, authenticated: false }` rather
than 401 when signed out, so the nav doesn't have to special-case an error.

### UI

- `/watchlists` — create lists, add targets, attach and pause rules. Frequencies
  above the user's tier render disabled and marked `(Pro)`.
- `/alerts` — inbox with unread filter, mark read, dismiss, cursor pagination.
- `/account` — alert email opt-out (the digest's unsubscribe link target).
- `WatchButton` on the vendor dossier and entity detail panel. Signed-out users
  get a link to `/signin` rather than a dead control; tier-limit errors surface
  inline, since hitting the free cap is the most likely failure and needs to
  explain itself.
- `AlertsBadge` in `TopNav` with unread count, polling every 120s — alerts only
  materialize when a cron runs, so anything faster is wasted requests.

### Cron wiring

No new cron entries, as specified.

- `daily-sync` → engine (`REALTIME` + `DAILY`) → `DAILY` digest
- `weekly-sync` → engine (`WEEKLY`, 8-day lookback) → `WEEKLY` digest

Both steps run after the existing data refresh and are individually wrapped: an
alert failure reports itself in the response summary but never fails a sync that
already succeeded.

Bounded per run: 500 rules, 50 events per rule, 200 targets per rule. Hitting the
rule cap logs a warning and sets `truncated` in the result rather than silently
dropping work.

## Verified

Engine (15 assertions, direct invocation against local `dev.db`):
- `NEW_CONTRACT` fires on a fresh award; title carries vendor + formatted value;
  URL points at the vendor page
- Re-running creates nothing and counts the duplicate — dedupe works
- `minValue` param filters correctly
- First sight of a FedRAMP package emits no event but records the baseline
- A status flip is then detected, with both old and new values in the body
- Rules on an empty watchlist are skipped, not scanned
- Inactive rules aren't evaluated; a WEEKLY run ignores DAILY rules

Digest (9 assertions):
- Injected markup in a title is escaped in the HTML
- Relative URLs absolutized; palette and text alternative present
- Missing `RESEND_API_KEY` skips cleanly instead of throwing
- Downgraded user gets no DAILY digest, and the event stays unemailed
- Opt-out is skipped and its events marked handled

HTTP (31 checks):
- 401 unauthenticated; Free capped at 1 watchlist / 5 items with typed error
  codes; Pro unrestricted
- Free denied DAILY rules with `allowed: ["WEEKLY"]`; duplicate rule → 409
- Cross-user: rename, delete, mark-read, and dismiss against another user's rows
  all fail (404 / zero-count) and the target rows verified intact afterward
- WATCH toggle round-trips; bogus entity id → 404
- Pages 200 signed in, 307 to `/signin` signed out

All test rows removed from `dev.db` afterward.

## Follow-ups

1. **Run `npm run migrate:turso:alerts` against production Turso.** Phase 1's
   `migrate:turso:auth` is still outstanding too and must run first — these
   tables have FKs to `User`.
2. **`RESEND_API_KEY` and `EMAIL_FROM` are required for any email to send.**
   Without them the engine still populates the in-app inbox; digests skip with a
   logged reason. Verify the sending domain in Resend first.
3. **`AUTH_URL` is used as the digest link base**, falling back to
   `https://intel.ironechelon.com`. Set it in Vercel if the domain ever differs.
4. **Name-based ATO matching is provisional** — replace with the Phase 3 FKs.
5. **The evaluator tests were throwaway scripts, not committed tests.** Phase 5
   is scheduled to add the permanent Vitest suite; these two subsystems are the
   ones it names, and the assertions above are the cases worth porting.
6. `/pricing` still doesn't exist. Tier-limit copy says "Upgrade to Pro" without
   anywhere to go — Phase 5 fixes this.
7. Snapshot writes are one upsert per changed key. Fine at current scale; if the
   watched universe grows large, batch them.

## Notes for Phase 3

- Adding `entityId` to `FedrampAuthorization` / `DodProvisionalAuth` /
  `EmassAuthorization` lets `evaluators.ts` drop `matchesWatchedName` entirely.
- `AlertSnapshot` is generic (`kind`, `key`, `value`) and can carry crosswalk
  change detection without a schema change.
- `WatchlistItem.targetType` already includes `FEDRAMP_CSO`, so the compliance
  table rows can carry a WATCH button with no new plumbing.
