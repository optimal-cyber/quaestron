import Anthropic from '@anthropic-ai/sdk'
import { ANALYST_TOOLS, runTool, type ToolRun } from './tools'

/**
 * The Quaestron AI analyst.
 *
 * A manual streaming tool loop rather than the SDK's tool runner: the runner is
 * a beta surface, and this loop has to interleave its own SSE events (tool-call
 * lines shown live in the UI) between model turns, which is exactly the control
 * the runner doesn't hand back. The loop shape follows the documented
 * "Streaming Manual Loop" pattern — stream, `finalMessage()`, inspect
 * `stop_reason`, execute tools, append results, repeat.
 */

/**
 * Defaults to the current Sonnet. The original Phase 4 spec named
 * `claude-sonnet-4-6`, which still works — set ANTHROPIC_MODEL to pin it, or to
 * `claude-opus-5` for the hardest analysis. Sonnet 5 is the better default here
 * because this workload is tool-calling and agentic, where it is markedly
 * stronger than 4.6 at the same tier.
 */
const DEFAULT_MODEL = 'claude-sonnet-5'

/**
 * Chat turns, not agentic runs. Streaming means HTTP timeouts aren't the
 * constraint, so this is a deliberate cost ceiling rather than a technical one —
 * an analyst answer that needs more than this is a sign the question should be
 * split, and an unbounded cap on a per-message-billed product is a liability.
 */
const MAX_TOKENS = 16000

/** Bounds one turn's tool loop. Six tools, and no question should need many rounds. */
const MAX_TOOL_ROUNDS = 8

const SYSTEM_PROMPT = `You are the Quaestron analyst — a defense-market intelligence analyst working for acquisition officers, capture teams, and investors evaluating defense technology vendors.

You answer questions using ONLY the tools provided. They query Quaestron's own datasets: FedRAMP Marketplace authorizations, DISA DCAS provisional authorizations, eMASS system ATOs, USASpending federal contract awards, SBIR/STTR awards, SAM.gov registrations, and a curated relationship graph.

## Citing your sources

Every tool result carries a \`dataset\` field. Name the dataset an answer came from — "per the FedRAMP Marketplace feed", "from USASpending obligations". An acquisition officer may act on what you say and needs to know its provenance.

## Never fabricate

- Never state a contract value, authorization level, award date, or agency relationship that did not come back from a tool. If you did not query it, you do not know it.
- Do not fill gaps from background knowledge about these companies. A widely-known fact that is not in the dataset is still not something this platform can support, and the user cannot tell which is which.
- Never invent an entity slug. Resolve names with search_entities first.

## Absent data is not zero

This matters more than anything else here.

- \`spendDataAvailable: false\` means federal obligations are UNKNOWN for that vendor, because enrichment has not run. It does NOT mean the vendor has won nothing. Saying a major prime "has no federal contracts" because of a null cache would be a serious error. Say "spend data has not been collected for this vendor yet."
- An empty result means the dataset has no record — not that the real-world thing does not exist. "No funding rounds on file" is not "unfunded".
- \`linkedToTrackedVendor: false\` on an authorization means the vendor name has not been resolved to a tracked entity, so its spend cannot be joined. Say so rather than treating it as a vendor with no contracts.
- When data is missing, say so plainly and suggest the closest question the data CAN answer.

## FedRAMP dates

FedRAMP authorizations do not hard-expire. The dates you get are next annual assessment due dates; an authorization lapses only if the assessment is unmet. Call them "assessment due" dates, never "expiration".

## Working style

- Call tools before answering. For a named vendor: search_entities, then get_entity_profile.
- Use get_entity_profile for single-vendor questions and list_authorizations for market-wide ones.
- Lead with the answer, then the supporting detail. An acquisition officer wants the finding first.
- Be concise. Prose for analysis; a short table only when comparing several vendors on the same fields.
- Flag risk flags, foreign HQ, inactive SAM registration, and near-term assessment dates when they bear on the question — they are usually why someone is asking.
- When a vendor is authorized but has zero recorded obligations AND spend data is available, that is genuine whitespace and worth calling out.

## Scope

You cover defense-tech vendors, their authorizations, contracts, funding, and relationships. For questions outside that, say what you do cover. Do not give legal, contractual, or acquisition-regulation advice — you surface data, not determinations.`

let cachedClient: Anthropic | null = null

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AnalystUnavailableError('ANTHROPIC_API_KEY is not configured')
  }
  cachedClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return cachedClient
}

export class AnalystUnavailableError extends Error {}

export function analystConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export function analystModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL
}

// ─── Streaming events ──────────────────────────────────────────────

export type AnalystEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_done'; name: string; summary: string; isError: boolean }
  | { type: 'done'; stopReason: string | null; toolRuns: ToolRun[]; text: string }
  | { type: 'error'; message: string; retryable: boolean }

export interface AnalystTurn {
  /** Prior conversation, oldest first. */
  history: Anthropic.MessageParam[]
  /** Extra context prepended to the system prompt (e.g. seeded vendor). */
  context?: string | null
}

/**
 * Runs one analyst turn, yielding events as they happen.
 *
 * The caller is responsible for persisting the final assistant message — this
 * generator deliberately owns no database writes so a disconnected client can't
 * leave a half-written transcript.
 */
export async function* runAnalystTurn(turn: AnalystTurn): AsyncGenerator<AnalystEvent> {
  let anthropic: Anthropic
  try {
    anthropic = client()
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
    }
    return
  }

  const messages: Anthropic.MessageParam[] = [...turn.history]
  const system = turn.context
    ? `${SYSTEM_PROMPT}\n\n## Current context\n\nThe user opened this thread from a vendor page. Unless they ask about something else, they mean: ${turn.context}`
    : SYSTEM_PROMPT

  const toolRuns: ToolRun[] = []
  let assistantText = ''

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let message: Anthropic.Message

    try {
      const stream = anthropic.messages.stream({
        model: analystModel(),
        max_tokens: MAX_TOKENS,
        system,
        tools: ANALYST_TOOLS,
        messages,
        // Adaptive thinking lets the model decide when a question needs
        // reasoning. `budget_tokens` is removed on current models.
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
      })

      // Iterate raw stream events so text forwards as it arrives. Only
      // text_delta is surfaced — thinking_delta stays internal, and the
      // model's reasoning is never shown to the user.
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text }
        }
      }

      message = await stream.finalMessage()
    } catch (err) {
      yield errorEvent(err)
      return
    }

    // Refusals arrive as a successful response with an empty or partial body —
    // check stop_reason before reading content, or this throws on content[0].
    if (message.stop_reason === 'refusal') {
      yield {
        type: 'error',
        message:
          'The model declined to answer that request. Rephrase it, or ask about vendor authorizations, contracts, or funding directly.',
        retryable: false,
      }
      yield { type: 'done', stopReason: 'refusal', toolRuns, text: assistantText }
      return
    }

    for (const block of message.content) {
      if (block.type === 'text') assistantText += block.text
    }

    if (message.stop_reason !== 'tool_use') {
      if (message.stop_reason === 'max_tokens') {
        yield {
          type: 'text',
          text: '\n\n[Response truncated at the length limit — ask a narrower question for the rest.]',
        }
      }
      yield { type: 'done', stopReason: message.stop_reason, toolRuns, text: assistantText }
      return
    }

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    // The full content block must go back verbatim — dropping thinking or
    // tool_use blocks breaks the next turn.
    messages.push({ role: 'assistant', content: message.content })

    const results: Anthropic.ToolResultBlockParam[] = []
    for (const use of toolUses) {
      yield { type: 'tool_start', name: use.name }
      const run = await runTool(use.name, use.input)
      toolRuns.push(run)
      yield { type: 'tool_done', name: run.name, summary: run.summary, isError: run.isError }
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(run.result),
        ...(run.isError ? { is_error: true } : {}),
      })
    }

    // All results go back in ONE user message — splitting them across messages
    // trains the model out of making parallel calls.
    messages.push({ role: 'user', content: results })
  }

  yield {
    type: 'text',
    text: `\n\n[Stopped after ${MAX_TOOL_ROUNDS} rounds of queries without reaching an answer. Try a narrower question.]`,
  }
  yield { type: 'done', stopReason: 'max_tool_rounds', toolRuns, text: assistantText }
}

function errorEvent(err: unknown): AnalystEvent {
  // Typed exception chain, most specific first — the categories differ in
  // whether a retry is worth offering.
  if (err instanceof Anthropic.RateLimitError) {
    return { type: 'error', message: 'The analyst is rate limited. Try again shortly.', retryable: true }
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { type: 'error', message: 'Analyst credentials are invalid.', retryable: false }
  }
  if (err instanceof Anthropic.BadRequestError) {
    console.error('[analyst] bad request:', err.message)
    return { type: 'error', message: `Malformed analyst request: ${err.message}`, retryable: false }
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { type: 'error', message: 'Could not reach the analyst service.', retryable: true }
  }
  if (err instanceof Anthropic.APIError) {
    console.error('[analyst] api error:', err.status, err.message)
    return {
      type: 'error',
      message: `Analyst service error (${err.status}).`,
      retryable: (err.status ?? 500) >= 500,
    }
  }
  console.error('[analyst] unexpected error:', err)
  return { type: 'error', message: 'Unexpected analyst failure.', retryable: true }
}

/** Rebuilds Anthropic message history from persisted rows. */
export function toMessageHistory(
  rows: { role: string; content: string }[]
): Anthropic.MessageParam[] {
  return rows
    .filter((r) => r.content.trim().length > 0)
    .map((r) => ({
      role: r.role === 'USER' ? ('user' as const) : ('assistant' as const),
      content: r.content,
    }))
}

/** First line of the opening question, used as the thread title. */
export function deriveTitle(firstMessage: string): string {
  const line = firstMessage.trim().split('\n')[0]?.trim() ?? ''
  if (!line) return 'New thread'
  return line.length > 70 ? `${line.slice(0, 67)}…` : line
}
