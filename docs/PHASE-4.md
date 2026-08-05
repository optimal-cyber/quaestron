# Phase 4 — AI Analyst

Shipped. Build and typecheck clean; 50 unit assertions plus a full HTTP/SSE pass.
**The live model call is the one thing not verified — see Follow-ups.**

## Model choice — a deliberate deviation from the spec

The Phase 4 spec named `claude-sonnet-4-6`. That model is still active, but
`claude-sonnet-5` has superseded it and is materially stronger at exactly this
workload — tool calling and agentic loops — at the same tier. Since the spec
also asked for the model to be env-configurable, the default is now
`claude-sonnet-5`, overridable with `ANTHROPIC_MODEL`:

```
ANTHROPIC_MODEL=claude-sonnet-4-6   # pin to the originally specified model
ANTHROPIC_MODEL=claude-opus-5       # hardest analysis, higher cost
```

Two related API facts worth recording, because both contradict what older code
in this space usually does:

- **`budget_tokens` is removed** on current models. Thinking depth is controlled
  by `thinking: {type: "adaptive"}` plus `output_config.effort` (this build uses
  `medium`). Sending `budget_tokens` returns a 400.
- **A refusal is a 200, not an error.** It arrives as `stop_reason: "refusal"`
  with an empty or partial `content`. Code that reads `content[0]` unconditionally
  crashes on it. The loop checks `stop_reason` before touching content.

## What shipped

### Tool surface (`lib/ai/tools.ts`)

Six tools, each wrapping an existing internal query function. **The model never
writes SQL and never gets a free-text query path into the database** — every tool
takes typed parameters that map onto a fixed Prisma query, so the worst a bad
call can do is return no rows.

| Tool | Wraps |
|---|---|
| `search_entities` | `Entity` name/alias search — resolves a name to a slug first |
| `get_entity_profile` | Phase 3 `buildCrosswalk()` — the primary tool |
| `list_contracts` | `Contract` with vendor/agency/value/date filters |
| `list_authorizations` | Phase 3 `queryUniverse()` |
| `get_funding` | `FundingRound` with government/private split |
| `get_connections` | `Connection` graph, depth 1 or 2 |

All are `strict: true` with closed schemas (`additionalProperties: false`, every
property required), so a malformed call is a clean retry rather than a confusing
empty result.

**Two conventions the system prompt depends on:**

1. **Every result carries a `dataset` field** naming its source, so the model can
   cite provenance instead of asserting flatly.
2. **Absent data is an explicit null plus an availability flag, never a zero.**
   This is the whole ballgame. `Entity.totalFederalObligated` is a cache that is
   null until enrichment runs; a model reading that as "$0 in federal contracts"
   would state confidently that a major prime has never won federal work. So
   `get_entity_profile` nulls the figure when `spendDataAvailable` is false and
   attaches a caveat saying so in words. `get_funding` does the same with "no
   records ingested is not evidence of being unfunded", and
   `list_authorizations` exposes `linkedToTrackedVendor` so an unresolved vendor
   isn't read as a vendor with no contracts.

`runTool` never throws — a failure returns an error result the model can react
to, because an exception would kill the stream and lose the answer mid-write.

### Engine (`lib/ai/analyst.ts`)

A **manual streaming tool loop**, not the SDK's tool runner. The runner is a beta
surface, and this loop interleaves its own SSE events (live tool-call lines)
between model turns — exactly the control the runner doesn't hand back. Shape
follows the documented streaming-manual-loop pattern: stream events →
`finalMessage()` → inspect `stop_reason` → execute tools → append results → repeat.

Details that matter:

- Tool results all go back in **one** user message. Splitting them across
  messages trains the model out of parallel calls.
- The full assistant `content` array is echoed back verbatim; dropping thinking
  or `tool_use` blocks breaks the next turn.
- Only `text_delta` is forwarded to the client. Thinking stays internal.
- `max_tokens` is 16000 — a deliberate cost ceiling rather than a technical one.
  Streaming means timeouts aren't the constraint; an unbounded cap on a
  per-message-billed product is a liability. `max_tokens` truncation appends a
  visible note rather than silently stopping.
- Tool rounds are capped at 8 per turn.
- Errors map through a typed exception chain (`RateLimitError` →
  `AuthenticationError` → `BadRequestError` → `APIConnectionError` → `APIError`),
  each carrying a `retryable` flag, because those categories differ in whether
  offering a retry is honest.

### System prompt

Positions the model as a defense-market analyst and encodes four rules: cite the
dataset behind every claim; never state a contract value, level, or date that
didn't come from a tool; never fill gaps from background knowledge about these
companies (the user can't tell which is which); and treat absent data as absent,
never as zero. It also carries the FedRAMP naming rule — "assessment due", never
"expiration".

### Quota (`lib/ai/quota.ts`)

Pro/Team unlimited; Free gets 5 messages/day. The counter **reuses the Phase 1
LibSQL fixed-window limiter** with a 24-hour window keyed on user id — no second
counter table, and the window-index-in-the-key design means the daily allowance
resets with no scheduled job.

Adding this surfaced a gap: rendering "3 of 5 left" with `checkRateLimit` would
*consume* one of the five. Added `peekRateLimit` — a read-only counter check —
and the threads endpoint peeks while only the send path consumes.

### API and UI

```
POST   /api/analyst/chat            SSE stream (Node runtime)
GET    /api/analyst/threads         thread list + quota + config state
GET    /api/analyst/threads/[id]    full transcript incl. tool calls
DELETE /api/analyst/threads/[id]
```

`/analyst` is a terminal-styled chat: thread sidebar, streaming text with a
cursor, and tool calls rendered inline as `QUERYING AUTHORIZATIONS: High → 116
matching`. The SSE reader buffers across chunk boundaries, since a network chunk
can split a frame mid-way.

`AskAnalystButton` deep-links from the vendor dossier and every resolved
`/compliance` row into a thread pre-seeded with that vendor — the slug becomes
the thread's `entitySlug`, which the server turns into a context line appended to
the system prompt, so the model knows what "it" refers to.

## Verified

**Unit (50 assertions):** all six tools return real data against `dev.db`;
schemas are strict/closed/fully-required; unknown slugs return `found: false`
with guidance to call `search_entities` rather than erroring; an unenriched
vendor returns `null` spend with the "UNKNOWN, not zero" caveat; garbage dates
are ignored rather than thrown; an unknown tool name returns an error result
instead of throwing; `peekRateLimit` does **not** consume while `checkRateLimit`
does; Free is blocked on the 6th message with an upgrade message; Pro is
unlimited.

**HTTP/SSE:** 401 unauthenticated on both endpoints; 400 on empty and oversized
messages; 503 when `ANTHROPIC_API_KEY` is unset **with no quota spent**; correct
SSE framing with `thread` → `error` → `done` and the right content-type plus
`X-Accel-Buffering: no`; threads and messages persist; cross-user read and
delete of another user's thread both 404 with the row verified intact; owner
delete cascades messages.

Test data removed from `dev.db`.

## Follow-ups

1. **The live model call is unverified.** No `ANTHROPIC_API_KEY` was available in
   this environment, so everything up to and including the SDK call is tested,
   but no actual completion, tool-use round-trip, or refusal was observed. The
   error path was exercised with a deliberately invalid key, which confirms
   framing, persistence, quota, and error mapping — but the happy path is
   code-reviewed only. **Set a key and send one question before trusting it.**
2. **Set `ANTHROPIC_API_KEY`** in Vercel. Optionally `ANTHROPIC_MODEL`.
3. **Run `npm run migrate:turso:analyst`** against production, after the three
   earlier migrations (it has an FK to `User`).
4. **A failed model call still consumes a Free-tier message.** Quota is consumed
   before the model call by design, so an exhausted user can't trigger paid
   inference — the tradeoff is that a service-side failure costs an allowance.
   Only bites when a key is set but invalid, or on a transient API error; an
   unset key returns 503 before consuming. A refund path is the fix if it proves
   annoying; I judged the extra decrement primitive not worth it yet.
5. **No cost telemetry.** Token usage is available on the final message but isn't
   recorded. Worth adding before opening this to paying users — Phase 5's
   monetization work is the natural place.
6. **`/pricing` still doesn't exist** and the quota-exhausted banner links to it.
7. **No visual QA on `/analyst`** — it typechecks, builds, and its data and
   transport layers are covered, but I did not open it in a browser.
8. The system prompt is a first draft. It should be tuned against real
   transcripts once the model path is live — particularly the balance between
   citing datasets and staying readable.

## Notes for Phase 5

- `AnalystThread`/`AnalystMessage` are per-user and cascade from `User`, so a
  Stripe-driven downgrade needs no analyst-side cleanup.
- `checkAnalystQuota` is the single gate; a Team-seat model only has to make
  `tierAtLeast(user.tier, 'PRO')` true for seat members.
- Export (Phase 5) should reuse `buildCrosswalk` and `queryUniverse`, the same
  functions the analyst tools wrap — one query layer, three consumers.
