'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface ToolCall {
  name: string
  summary: string
  isError: boolean
}

interface Turn {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  toolCalls: ToolCall[]
  /** Set while the turn is still streaming. */
  pending?: boolean
  error?: string | null
}

interface ThreadSummary {
  id: string
  title: string
  entitySlug: string | null
  messageCount: number
}

interface Quota {
  remaining: number | null
  limit: number | null
  unlimited: boolean
}

const TOOL_LABELS: Record<string, string> = {
  search_entities: 'SEARCHING ENTITIES',
  get_entity_profile: 'BUILDING VENDOR PROFILE',
  list_contracts: 'QUERYING CONTRACTS',
  list_authorizations: 'QUERYING AUTHORIZATIONS',
  get_funding: 'QUERYING FUNDING',
  get_connections: 'TRAVERSING RELATIONSHIPS',
}

const SUGGESTIONS = [
  'Which vendors hold DoD IL5 authorizations?',
  'What FedRAMP assessments are due in the next 90 days?',
  'Show small-business vendors authorized at FedRAMP High',
  'Which agencies sponsor the most authorizations?',
]

export default function AnalystClient({
  tier,
  configured,
  model,
  initialThreadId,
  seededEntity,
  seededPrompt,
}: {
  tier: string
  configured: boolean
  model: string | null
  initialThreadId: string | null
  seededEntity: string | null
  seededPrompt: string | null
}) {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [threadId, setThreadId] = useState<string | null>(initialThreadId)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState(seededPrompt ?? '')
  const [streaming, setStreaming] = useState(false)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch('/api/analyst/threads').then((r) => r.json())
      if (res?.data) {
        setThreads(res.data.threads)
        setQuota(res.data.quota)
      }
    } catch {
      /* non-fatal — the sidebar just stays empty */
    }
  }, [])

  const loadThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/analyst/threads/${id}`).then((r) => r.json())
      if (!res?.data) return
      setTurns(
        res.data.messages.map((m: { id: string; role: 'USER' | 'ASSISTANT'; content: string; toolCalls: ToolCall[] }) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls ?? [],
        }))
      )
      setThreadId(id)
    } catch {
      setError('Could not load that thread.')
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  useEffect(() => {
    if (initialThreadId) void loadThread(initialThreadId)
  }, [initialThreadId, loadThread])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  async function send(text: string) {
    const question = text.trim()
    if (!question || streaming) return

    setError(null)
    setInput('')
    setStreaming(true)

    const userTurn: Turn = {
      id: `local-${Date.now()}`,
      role: 'USER',
      content: question,
      toolCalls: [],
    }
    const assistantTurn: Turn = {
      id: `local-${Date.now()}-a`,
      role: 'ASSISTANT',
      content: '',
      toolCalls: [],
      pending: true,
    }
    setTurns((prev) => [...prev, userTurn, assistantTurn])

    try {
      const res = await fetch('/api/analyst/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, threadId, entitySlug: seededEntity }),
      })

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => null)
        const msg = json?.error || 'The analyst could not be reached.'
        setError(msg)
        setTurns((prev) =>
          prev.map((t) => (t.id === assistantTurn.id ? { ...t, pending: false, error: msg } : t))
        )
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // SSE frames are separated by a blank line; a chunk can split one, so
      // hold the remainder in the buffer rather than parsing per chunk.
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          const eventLine = frame.split('\n').find((l) => l.startsWith('event: '))
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
          if (!eventLine || !dataLine) continue

          const type = eventLine.slice(7).trim()
          let payload: Record<string, unknown>
          try {
            payload = JSON.parse(dataLine.slice(6))
          } catch {
            continue
          }

          if (type === 'thread') {
            setThreadId(payload.threadId as string)
            if (payload.limit !== null) {
              setQuota({
                remaining: payload.remaining as number,
                limit: payload.limit as number,
                unlimited: false,
              })
            }
          } else if (type === 'text') {
            const chunk = payload.text as string
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantTurn.id ? { ...t, content: t.content + chunk } : t
              )
            )
          } else if (type === 'tool_done') {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantTurn.id
                  ? {
                      ...t,
                      toolCalls: [
                        ...t.toolCalls,
                        {
                          name: payload.name as string,
                          summary: payload.summary as string,
                          isError: Boolean(payload.isError),
                        },
                      ],
                    }
                  : t
              )
            )
          } else if (type === 'error') {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantTurn.id ? { ...t, error: payload.message as string } : t
              )
            )
          }
        }
      }

      setTurns((prev) =>
        prev.map((t) => (t.id === assistantTurn.id ? { ...t, pending: false } : t))
      )
      void loadThreads()
    } catch {
      const msg = 'The analyst stream was interrupted.'
      setError(msg)
      setTurns((prev) =>
        prev.map((t) => (t.id === assistantTurn.id ? { ...t, pending: false, error: msg } : t))
      )
    } finally {
      setStreaming(false)
    }
  }

  const exhausted = quota !== null && !quota.unlimited && (quota.remaining ?? 0) <= 0

  return (
    <div className="h-full flex">
      {/* Threads */}
      <aside className="hidden lg:flex flex-col w-64 border-r border-border bg-surface/40 shrink-0">
        <div className="px-3 py-3 border-b border-border">
          <button
            onClick={() => {
              setThreadId(null)
              setTurns([])
              setError(null)
            }}
            className="w-full px-3 py-2 font-mono text-[12px] tracking-[0.2em] text-accent-red border border-accent-red/40 hover:bg-accent-red/10 transition-colors"
          >
            + NEW THREAD
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {threads.length === 0 && (
            <p className="px-2 py-3 font-mono text-[12px] text-muted">No threads yet.</p>
          )}
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => loadThread(t.id)}
              className={`w-full text-left px-2 py-2 rounded font-mono text-[13px] transition-colors ${
                t.id === threadId
                  ? 'bg-accent-red/10 text-accent-red'
                  : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
              }`}
            >
              <div className="truncate">{t.title}</div>
              <div className="text-[11px] text-muted mt-0.5">
                {t.messageCount} msg{t.messageCount === 1 ? '' : 's'}
                {t.entitySlug ? ` · ${t.entitySlug}` : ''}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Conversation */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="px-4 py-3 border-b border-border flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="font-mono text-[12px] tracking-[0.3em] text-muted">
              DEFENSE MARKET ANALYST
            </div>
            <h1 className="font-mono text-lg tracking-[0.08em] text-foreground uppercase mt-0.5">
              <span className="text-accent-red">&#x276E;</span> ANALYST
            </h1>
          </div>
          <div className="font-mono text-[12px] text-muted text-right">
            {model && <div>MODEL {model}</div>}
            <div>
              TIER <span className="text-accent-gold">{tier}</span>
              {quota && !quota.unlimited && (
                <>
                  {' · '}
                  <span className={exhausted ? 'text-accent-red' : 'text-muted-foreground'}>
                    {quota.remaining}/{quota.limit} TODAY
                  </span>
                </>
              )}
            </div>
          </div>
        </header>

        {!configured && (
          <div className="m-4 border border-accent-gold/40 bg-accent-gold/10 px-3 py-2 font-mono text-[13px] text-accent-gold">
            The analyst is not configured on this deployment — set ANTHROPIC_API_KEY.
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {turns.length === 0 && (
            <div className="max-w-2xl mx-auto pt-8 space-y-4">
              <p className="font-mono text-[13px] text-muted-foreground leading-relaxed">
                Ask about vendor authorizations, federal contract history, funding, or
                relationships. Every answer is built from Quaestron&apos;s own datasets —
                the analyst queries them live and cites which one it used.
              </p>
              <div className="space-y-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={streaming || !configured}
                    className="block w-full text-left px-3 py-2 rounded border border-border font-mono text-[13px] text-muted-foreground hover:border-border-bright hover:text-foreground disabled:opacity-40 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn) => (
            <article key={turn.id} className="max-w-3xl mx-auto">
              {turn.role === 'USER' ? (
                <div className="flex gap-3">
                  <span className="font-mono text-[12px] text-accent-blue shrink-0 pt-0.5">
                    YOU
                  </span>
                  <p className="font-mono text-[12px] text-foreground leading-relaxed whitespace-pre-wrap">
                    {turn.content}
                  </p>
                </div>
              ) : (
                <div className="flex gap-3">
                  <span className="font-mono text-[12px] text-accent-red shrink-0 pt-0.5">
                    ANALYST
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    {turn.toolCalls.map((call, i) => (
                      <div
                        key={i}
                        className={`font-mono text-[12px] ${call.isError ? 'text-accent-red' : 'text-muted'}`}
                      >
                        <span className="text-accent-gold">
                          {TOOL_LABELS[call.name] || call.name.toUpperCase()}
                        </span>
                        {': '}
                        {call.summary}
                      </div>
                    ))}

                    {turn.pending && turn.content === '' && turn.toolCalls.length === 0 && (
                      <div className="font-mono text-[12px] text-muted animate-pulse">
                        THINKING…
                      </div>
                    )}

                    {turn.content && (
                      <div className="font-mono text-[12px] text-foreground leading-relaxed whitespace-pre-wrap">
                        {turn.content}
                        {turn.pending && <span className="text-accent-red animate-pulse">▊</span>}
                      </div>
                    )}

                    {turn.error && (
                      <div className="border border-accent-red/40 bg-accent-red/10 px-3 py-2 font-mono text-[12px] text-accent-red">
                        {turn.error}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>

        {error && (
          <div className="mx-4 mb-2 border border-accent-gold/40 bg-accent-gold/10 px-3 py-2 font-mono text-[12px] text-accent-gold">
            {error}
            {exhausted && (
              <>
                {' '}
                <Link href="/pricing" className="underline">
                  Upgrade to Pro
                </Link>{' '}
                for unlimited messages.
              </>
            )}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
          className="border-t border-border p-3 flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
            }}
            rows={2}
            maxLength={4000}
            disabled={streaming || !configured || exhausted}
            placeholder={
              exhausted
                ? 'Daily message limit reached — upgrade to Pro for unlimited access.'
                : 'Ask about a vendor, an impact level, an agency…'
            }
            className="flex-1 resize-none bg-background border border-border focus:border-accent-blue px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-muted/60 outline-none transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim() || !configured || exhausted}
            className="px-4 py-2 font-mono text-[12px] tracking-[0.2em] text-accent-red border border-accent-red/40 hover:bg-accent-red/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {streaming ? '…' : 'SEND'}
          </button>
        </form>
      </div>
    </div>
  )
}
