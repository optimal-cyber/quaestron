# Migration spec — `intel.ironechelon.com` → `quaestron.io`

**Audience:** Claude Code, operating on this repo.
**Status:** not started.
**Author's intent:** this is a domain migration *and* a product rebrand. They are
separable. Do the domain first. Do not interleave them.

---

## Hard rules

Read these before touching anything.

1. **This is not a find-and-replace.** `ironechelon.com` appears in three
   distinct roles in this codebase — the product's own origin, the *newsletter's*
   origin, and an infrastructure identifier. Only the first one moves. Blindly
   replacing every occurrence will break a working link and a live database
   connection.

2. **Two gates below are marked `STOP`.** They guard steps that, if run early,
   lock every user — including the operator — out of the application with no
   error surfaced in the UI. Do not pass a `STOP` gate on your own judgment. Ask
   the human to confirm the external prerequisite is done, and wait.

3. **The old domain stays alive.** At no point in this spec is
   `intel.ironechelon.com` removed from Vercel. It ends as a permanent redirect
   source, not a deleted domain.

4. **Never touch these**, though they match a naive `ironechelon` search:
   - `.env` → `TURSO_DATABASE_URL="libsql://ironechelon-optimal-cyber…"` — this
     is the live production database hostname. Renaming it disconnects the app.
   - `app/page.tsx:252`, `components/layout/TopNav.tsx:73`,
     `components/layout/TopNav.tsx:137` → these link to
     `https://www.ironechelon.com`, the Substack newsletter, which is
     **staying**. They are correct as written.
   - `package.json` / `package-lock.json` `"name": "watch-ironechelon"` — local
     package identifier, cosmetic, not worth a lockfile churn.

5. **Branch hygiene.** The working tree is currently on
   `phase-1-auth-foundation`. Create a dedicated branch off the intended base
   before making edits. Do not commit to whatever branch happens to be checked
   out.

---

## Phase 0 — External prerequisites (human, out-of-band)

Claude Code cannot do these. They must be confirmed complete before Phase 3.

- [ ] **0.1 — Add `quaestron.io` to the Vercel project** as an *additional*
      domain. Both domains serve the same deployment. Do not set it as primary
      yet, and do not remove the old one.
- [ ] **0.2 — Resend: add and verify `quaestron.io` as a sending domain.**
      Publish the SPF, DKIM, and DMARC records Resend issues, and wait for the
      dashboard to show verified. This typically takes minutes but can take
      hours for DNS propagation.
- [ ] **0.3 — Google Cloud Console → Credentials → the OAuth 2.0 client:** add
      `https://quaestron.io/api/auth/callback/google` to Authorized redirect
      URIs. **Add, do not replace** — keeping the old URI means both domains
      authenticate during the overlap window.

> **Why 0.2 matters more than it looks.** Magic-link email via Resend is the
> primary authentication path for this app (`lib/auth.ts:46-51`). If the app
> starts sending from `@quaestron.io` before Resend has verified that domain,
> Resend rejects the send, the sign-in page reports success, and no email ever
> arrives. Every user — including the operator — is locked out, and nothing in
> the UI says why. Separately: a brand-new sending domain has no reputation.
> Expect degraded deliverability on magic links and alert digests for the first
> few weeks regardless of correct configuration.

---

## Phase 1 — Decouple hardcoded origins from the brand (safe, additive)

These edits make the origin env-driven. They change no behaviour while
`AUTH_URL` still points at the old domain, so they can ship independently and
early.

### 1.1 — `app/layout.tsx:5`

The origin is hardcoded and feeds `metadataBase`, which every page's relative
OG/canonical URL resolves against.

```ts
// before
const siteUrl = "https://intel.ironechelon.com"

// after
const siteUrl = process.env.AUTH_URL?.replace(/\/$/, "") || "https://quaestron.io"
```

This mirrors the pattern already used in `lib/seo.ts:16`, so the two agree.

### 1.2 — `lib/seo.ts:16`

Change the fallback only. The `process.env.AUTH_URL` read is already correct.

```ts
export const SITE_URL = process.env.AUTH_URL?.replace(/\/$/, '') || 'https://quaestron.io'
```

### 1.3 — `lib/alerts/digest.ts:39`

Same change, same reasoning.

```ts
const siteUrl = (process.env.AUTH_URL || 'https://quaestron.io').replace(/\/$/, '')
```

### 1.4 — `lib/export/build.ts:31`

`SITE` is stamped into the provenance footer of every CSV and XLSX export. A
spreadsheet outlives the page it came from, so a stale domain here misattributes
files indefinitely. Do not just swap the string — remove the second source of
truth by deriving it from `SITE_URL`:

```ts
// before
const SITE = 'intel.ironechelon.com'

// after
import { SITE_URL } from '@/lib/seo'
const SITE = SITE_URL.replace(/^https?:\/\//, '')
```

Verify the import path matches this repo's alias convention before committing;
adjust to a relative import if `@/` is not configured.

### 1.5 — `lib/alerts/email.ts:148`

The digest footer hardcodes the domain even though `siteUrl` is already in scope
in `renderDigestHtml` (destructured at line 75).

```
// before
Generated by Iron Echelon &middot; intel.ironechelon.com

// after — use the value already available
Generated by Quaestron &middot; ${siteUrl.replace(/^https?:\/\//, '')}
```

### 1.6 — Export filename stems (cosmetic, no gate)

- `lib/export/build.ts:67` — `` `ironechelon-${…}` `` → `` `quaestron-${…}` ``
- `components/ExportButton.tsx:49` — `` `ironechelon-export.${format}` `` →
  `` `quaestron-export.${format}` ``

### 1.7 — `app/opengraph-image.tsx:163`

The domain is rendered into the social card image.

```
intel.ironechelon.com  →  quaestron.io
```

**Checkpoint:** run `npm run build` and `npm test`. Both must pass. Nothing
user-visible has changed yet, because `AUTH_URL` is unchanged.

---

## Phase 2 — Add the redirect and sitemap infrastructure

### 2.1 — Cross-domain 301

Handle this at the **Vercel domain level**, not in `next.config.ts`. In Vercel
project settings, set `quaestron.io` as the primary domain and configure
`intel.ironechelon.com` to redirect to it. Vercel issues a 308 that preserves
the path, which is what the programmatic pages under
`/compliance/cso/[packageId]` need.

Do not delete the old domain. Leave the redirect in place indefinitely — there
is no expiry after which dropping it becomes free.

### 2.2 — Missing sitemap and robots (recommended, flag to human first)

Neither `app/sitemap.ts` nor `app/robots.ts` exists in this repo. For a site
whose growth strategy is programmatic SEO pages, that is a real gap, and a
domain migration is the moment it costs the most — Google has no efficient way
to discover the new URLs.

Propose adding both, driven off `SITE_URL` from `lib/seo.ts`, with the sitemap
enumerating vendor dossiers and `/compliance/cso/[packageId]` offerings. **Do
not implement without confirmation** — it is scope beyond this migration.

---

## Phase 3 — Cutover

> ### STOP — GATE 1
> Do not proceed unless the human has confirmed **0.2 (Resend verified)** and
> **0.3 (Google redirect URI added)**. Ask explicitly. Passing this gate early
> locks all users out of authentication.

### 3.1 — Vercel environment variables (Production)

```
AUTH_URL   = https://quaestron.io
EMAIL_FROM = Quaestron <alerts@quaestron.io>
```

`AUTH_URL` propagates to `lib/seo.ts`, `lib/alerts/digest.ts`, and
`app/layout.tsx` in one move — that is the point of Phase 1.

Confirm the local-part of `EMAIL_FROM` (`alerts@`) with the human. The old value
used `intel@`, which was tied to the old product name.

### 3.2 — Code fallbacks for `EMAIL_FROM`

> ### STOP — GATE 2
> Same precondition as Gate 1. These two lines are the lockout risk.

- `lib/auth.ts:49` — `'Iron Echelon <intel@ironechelon.com>'` →
  `'Quaestron <alerts@quaestron.io>'`
- `lib/alerts/email.ts:203` — same string, same replacement

Keep these in sync with `EMAIL_FROM` in 3.1. They are fallbacks that only fire
when the env var is unset, which is exactly the situation in which a wrong value
is hardest to notice.

### 3.3 — `.env.example`

- line 26 — `# AUTH_URL="https://quaestron.io"`
- line 31 — `EMAIL_FROM="Quaestron <alerts@quaestron.io>"`

Leave the Google comment at line 34 as-is; it already uses a `<your-domain>`
placeholder.

### 3.4 — Deploy and verify before announcing

Run every item. Do not report the migration complete on a partial pass.

- [ ] `https://quaestron.io` serves the app over valid TLS
- [ ] `https://intel.ironechelon.com/compliance` 308s to
      `https://quaestron.io/compliance` — **path preserved**
- [ ] Magic-link sign-in: request a link with a *fresh* address, confirm the
      mail arrives, confirm it is not in spam, confirm the link authenticates
- [ ] Google sign-in completes without a `redirect_uri_mismatch`
- [ ] Page source shows `og:url` and canonical on `quaestron.io`
- [ ] OG card image renders and reads `quaestron.io`
- [ ] Export a CSV from `/compliance`; provenance footer reads `quaestron.io`
      and the filename stem is `quaestron-`
- [ ] Trigger a digest (or inspect the rendered HTML) — links resolve to
      `quaestron.io`, footer text is correct
- [ ] The newsletter links in `TopNav` still point to `www.ironechelon.com`

**Expected and not a bug:** every existing user is signed out at cutover.
Session cookies are scoped to the old origin. Sessions are database-backed
(`lib/auth.ts`), so the records survive; users simply re-authenticate. If the
user list is small, tell them in advance.

---

## Phase 4 — Brand string rename (separate change, separate PR)

Out of scope for the domain migration. Sequence it after Phase 3 has been
verified in production.

`"Iron Echelon"` appears **~45 times across 26 files**, including user-facing
copy in `app/about/page.tsx`, `app/data/page.tsx`, every `/compliance` page, the
signin flow, and — importantly — the AI analyst's own system prompt and tool
descriptions in `lib/ai/analyst.ts` (3) and `lib/ai/tools.ts` (2), where the
model refers to itself by product name.

Before starting, get one decision from the human: **the exact user-facing product
string**, including whether the tagline "Defense Tech Intelligence" survives.
`app/layout.tsx` alone contains 5 occurrences across `title`, `openGraph.title`,
and `siteName`, and they must agree.

`prisma/schema.prisma` and `CHANGELOG.md` each contain one occurrence in a
comment or historical entry. Leave the changelog history alone — it is a record
of what was true at the time.

---

## Rollback

Phase 1 and 2 are safe to leave deployed; they change no behaviour on their own.

If Phase 3 goes wrong:

1. Revert `AUTH_URL` and `EMAIL_FROM` in Vercel to their previous values and
   redeploy. This restores auth without a code revert, because Phase 1 made the
   origin env-driven.
2. In Vercel, set `intel.ironechelon.com` back to primary and remove the
   redirect.
3. `git revert` the Phase 3 commit only. Phase 1 does not need reverting.

The Google redirect URI and the verified Resend domain can stay in place
regardless — both are additive and harmless if unused.
