'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Admin panel section for ATO-feed names the matcher declined to auto-link.
 *
 * Resolving one name links every authorization row carrying it, so the queue is
 * per-name rather than per-row.
 */

interface Suggestion {
  entityId: string
  name: string
  slug: string
  score: number
  method: string
}

interface ReviewItem {
  id: string
  sourceType: string
  sourceName: string
  recordCount: number
  status: string
  suggestions: Suggestion[]
}

const SOURCE_LABELS: Record<string, string> = {
  FEDRAMP: 'FedRAMP',
  DOD_PA: 'DoD PA',
  EMASS: 'eMASS',
}

export default function AtoMatchReview() {
  const [items, setItems] = useState<ReviewItem[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [status, setStatus] = useState<'PENDING' | 'RESOLVED' | 'IGNORED'>('PENDING')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/ato-matches?status=${status}`).then((r) => r.json())
      if (res?.data) {
        setItems(res.data.items)
        setCounts(res.data.counts)
      }
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  async function act(id: string, action: string, entityId?: string) {
    setBusy(id)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/ato-matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, entityId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMessage(json?.error || 'Action failed')
        return
      }
      if (json?.data?.linked !== undefined) {
        setMessage(
          `Linked ${json.data.linked} row${json.data.linked === 1 ? '' : 's'} to ${json.data.entity?.name}.`
        )
      }
      await load()
    } catch {
      setMessage('Network error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="border border-border rounded-lg bg-surface/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-mono text-xs tracking-[0.15em] text-foreground uppercase">
          ATO Entity Match Review
        </h2>
        <div className="flex items-center gap-2">
          {(['PENDING', 'RESOLVED', 'IGNORED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-2 py-1 font-mono text-[12px] tracking-wider rounded border transition-colors ${
                status === s
                  ? 'text-accent-red border-accent-red/50 bg-accent-red/10'
                  : 'text-muted border-border hover:border-border-bright'
              }`}
            >
              {s} {counts[s] ? `(${counts[s]})` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-2">
        <p className="font-mono text-[12px] text-muted leading-relaxed">
          Vendor names from the authorization feeds that couldn&apos;t be resolved to a
          tracked entity with confidence. Resolving one name links every authorization row
          carrying it. Suggestions below the auto-match threshold are shown for context —
          they were deliberately <em>not</em> applied automatically.
        </p>

        {message && (
          <div className="border border-accent-green/40 bg-accent-green/10 px-3 py-2 font-mono text-[12px] text-accent-green">
            {message}
          </div>
        )}

        {loading && <div className="font-mono text-[13px] text-muted">LOADING…</div>}

        {!loading && items.length === 0 && (
          <div className="font-mono text-[13px] text-muted py-4">
            Nothing in {status.toLowerCase()}.
          </div>
        )}

        {items.map((item) => (
          <div
            key={item.id}
            className="px-3 py-2.5 rounded border border-border bg-background space-y-2"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] tracking-wider text-muted px-1.5 py-0.5 rounded border border-border">
                  {SOURCE_LABELS[item.sourceType] || item.sourceType}
                </span>
                <span className="font-mono text-xs text-foreground">{item.sourceName}</span>
                <span className="font-mono text-[12px] text-muted">
                  {item.recordCount} row{item.recordCount === 1 ? '' : 's'}
                </span>
              </div>
              {item.status === 'PENDING' ? (
                <div className="flex items-center gap-2">
                  <button
                    disabled={busy === item.id}
                    onClick={() => act(item.id, 'CREATE_ENTITY')}
                    className="px-2 py-1 font-mono text-[12px] tracking-wider text-accent-green border border-accent-green/40 hover:bg-accent-green/10 disabled:opacity-40 transition-colors"
                    title="Create a new tracked vendor from this name and link its rows"
                  >
                    + CREATE VENDOR
                  </button>
                  <button
                    disabled={busy === item.id}
                    onClick={() => act(item.id, 'IGNORE')}
                    className="px-2 py-1 font-mono text-[12px] tracking-wider text-muted border border-border hover:text-foreground disabled:opacity-40 transition-colors"
                  >
                    IGNORE
                  </button>
                </div>
              ) : (
                <button
                  disabled={busy === item.id}
                  onClick={() => act(item.id, 'REOPEN')}
                  className="px-2 py-1 font-mono text-[12px] tracking-wider text-muted border border-border hover:text-foreground disabled:opacity-40 transition-colors"
                >
                  REOPEN
                </button>
              )}
            </div>

            {item.status === 'PENDING' && item.suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
                <span className="font-mono text-[11px] text-muted">NEAR MATCHES:</span>
                {item.suggestions.map((s) => (
                  <button
                    key={s.entityId}
                    disabled={busy === item.id}
                    onClick={() => act(item.id, 'LINK', s.entityId)}
                    className="px-2 py-0.5 font-mono text-[12px] rounded border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/10 disabled:opacity-40 transition-colors"
                    title={`${s.method} · score ${s.score.toFixed(2)} — click to link`}
                  >
                    {s.name}
                    <span className="ml-1.5 text-muted">{s.score.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
