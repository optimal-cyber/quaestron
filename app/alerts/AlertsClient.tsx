'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { RULE_LABELS, type RuleType } from '@/lib/alerts/types'

interface AlertEvent {
  id: string
  ruleType: string
  title: string
  body: string
  url: string | null
  readAt: string | null
  createdAt: string
}

const RULE_ACCENT: Record<string, string> = {
  NEW_CONTRACT: 'text-accent-green border-accent-green/40',
  NEW_SBIR_AWARD: 'text-accent-green border-accent-green/40',
  FEDRAMP_STATUS_CHANGE: 'text-accent-gold border-accent-gold/40',
  ATO_EXPIRING: 'text-accent-red border-accent-red/40',
  RISK_FLAG_ADDED: 'text-accent-red border-accent-red/40',
  NEWS_MENTION: 'text-muted-foreground border-border',
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${Math.max(0, mins)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}

export default function AlertsClient() {
  const [events, setEvents] = useState<AlertEvent[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true)
      const params = new URLSearchParams()
      if (onlyUnread) params.set('unread', '1')
      if (cursor) params.set('cursor', cursor)
      try {
        const res = await fetch(`/api/alerts?${params}`).then((r) => r.json())
        if (res?.data) {
          setEvents((prev) => (cursor ? [...prev, ...res.data.events] : res.data.events))
          setUnreadCount(res.data.unreadCount)
          setNextCursor(res.data.nextCursor)
        }
      } finally {
        setLoading(false)
      }
    },
    [onlyUnread]
  )

  useEffect(() => {
    void load()
  }, [load])

  async function markRead(ids: string[] | 'all') {
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids === 'all' ? { all: true, read: true } : { ids, read: true }),
    })
    await load()
  }

  async function dismiss(id: string) {
    await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' })
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-5">
      <header className="space-y-2">
        <div className="font-mono text-[10px] tracking-[0.3em] text-muted">SIGNAL FEED</div>
        <h1 className="font-mono text-2xl md:text-3xl tracking-[0.08em] text-foreground uppercase">
          <span className="text-accent-red">&#x276E;</span> ALERTS
          {unreadCount > 0 && (
            <span className="ml-3 text-sm text-accent-red">{unreadCount} UNREAD</span>
          )}
        </h1>
        <p className="font-mono text-[11px] text-muted-foreground">
          Generated when the sync crons run.{' '}
          <Link href="/watchlists" className="text-accent-blue hover:underline">
            Manage watchlists and rules
          </Link>
          .
        </p>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setOnlyUnread((v) => !v)}
          className={`px-3 py-1.5 font-mono text-[10px] tracking-wider rounded border transition-colors ${
            onlyUnread
              ? 'text-accent-red border-accent-red/50 bg-accent-red/10'
              : 'text-muted-foreground border-border hover:border-border-bright'
          }`}
        >
          {onlyUnread ? 'SHOWING UNREAD' : 'SHOW ALL'}
        </button>
        {unreadCount > 0 && (
          <button
            onClick={() => markRead('all')}
            className="px-3 py-1.5 font-mono text-[10px] tracking-wider rounded border border-border text-muted-foreground hover:border-border-bright hover:text-foreground transition-colors"
          >
            MARK ALL READ
          </button>
        )}
      </div>

      {!loading && events.length === 0 && (
        <div className="border border-border rounded-lg bg-surface/40 p-8 text-center">
          <div className="font-mono text-xs text-muted-foreground mb-2">
            {onlyUnread ? 'NOTHING UNREAD' : 'NO ALERTS YET'}
          </div>
          <p className="font-mono text-[11px] text-muted">
            Alerts appear here after the daily or weekly sync evaluates your rules.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {events.map((event) => {
          const accent = RULE_ACCENT[event.ruleType] || 'text-muted-foreground border-border'
          const [tone, borderTone] = accent.split(' ')
          const external = event.url?.startsWith('http')

          return (
            <article
              key={event.id}
              className={`border rounded bg-surface/40 border-l-2 ${borderTone} ${
                event.readAt ? 'border-border opacity-70' : 'border-border'
              }`}
            >
              <div className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className={`font-mono text-[9px] tracking-[0.2em] ${tone}`}>
                    {(RULE_LABELS[event.ruleType as RuleType] || event.ruleType).toUpperCase()}
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[10px] text-muted">
                    <span>{relative(event.createdAt)}</span>
                    {!event.readAt && (
                      <button
                        onClick={() => markRead([event.id])}
                        className="hover:text-foreground transition-colors"
                      >
                        MARK READ
                      </button>
                    )}
                    <button
                      onClick={() => dismiss(event.id)}
                      className="hover:text-accent-red transition-colors"
                    >
                      DISMISS
                    </button>
                  </div>
                </div>

                <h2 className="font-mono text-sm text-foreground mt-2 leading-snug">
                  {event.title}
                </h2>

                {event.body && (
                  <div className="mt-2 space-y-0.5">
                    {event.body
                      .split('\n')
                      .filter(Boolean)
                      .map((line, i) => (
                        <div key={i} className="font-mono text-[11px] text-muted-foreground leading-relaxed">
                          {line}
                        </div>
                      ))}
                  </div>
                )}

                {event.url &&
                  (external ? (
                    <a
                      href={event.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-3 font-mono text-[10px] tracking-[0.15em] text-accent-red hover:underline"
                    >
                      OPEN SOURCE ›
                    </a>
                  ) : (
                    <Link
                      href={event.url}
                      className="inline-block mt-3 font-mono text-[10px] tracking-[0.15em] text-accent-red hover:underline"
                    >
                      OPEN ›
                    </Link>
                  ))}
              </div>
            </article>
          )
        })}
      </div>

      {nextCursor && (
        <button
          onClick={() => load(nextCursor)}
          disabled={loading}
          className="w-full px-3 py-2 font-mono text-[10px] tracking-wider text-muted-foreground border border-border hover:border-border-bright hover:text-foreground disabled:opacity-50 transition-colors"
        >
          {loading ? 'LOADING…' : 'LOAD MORE'}
        </button>
      )}
    </div>
  )
}
