'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  FREQUENCIES,
  RULE_LABELS,
  RULE_TARGETS,
  RULE_TYPES,
  TARGET_LABELS,
  type Frequency,
  type RuleType,
  type TargetType,
} from '@/lib/alerts/types'

interface Item {
  id: string
  targetType: TargetType
  targetId: string | null
  targetValue: string | null
  targetKey: string
  label: string | null
}

interface Watchlist {
  id: string
  name: string
  ruleCount: number
  items: Item[]
}

interface Rule {
  id: string
  ruleType: string
  channel: string
  frequency: string
  active: boolean
  lastRunAt: string | null
  eventCount: number
  watchlist: { id: string; name: string; itemCount: number } | null
}

interface Limits {
  maxWatchlists: number | null
  maxItemsPerWatchlist: number | null
  frequencies: Frequency[]
}

export default function WatchlistsClient({ tier }: { tier: string }) {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [limits, setLimits] = useState<Limits | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [wRes, rRes] = await Promise.all([
        fetch('/api/watchlists').then((r) => r.json()),
        fetch('/api/alerts/rules').then((r) => r.json()),
      ])
      if (wRes?.data) {
        setWatchlists(wRes.data.watchlists)
        setLimits(wRes.data.limits)
      }
      if (rRes?.data) setRules(rRes.data.rules)
    } catch {
      setError('Failed to load watchlists')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setError(null)
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      setError(json?.error || 'Request failed')
      return false
    }
    await load()
    return true
  }

  const atWatchlistCap =
    limits?.maxWatchlists !== null &&
    limits?.maxWatchlists !== undefined &&
    watchlists.length >= limits.maxWatchlists

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[12px] tracking-[0.3em] text-muted">TARGET TRACKING</div>
        <h1 className="font-mono text-2xl md:text-3xl tracking-[0.08em] text-foreground uppercase">
          <span className="text-accent-red">&#x276E;</span> WATCHLISTS
        </h1>
        <p className="font-mono text-[13px] text-muted-foreground max-w-2xl leading-relaxed">
          Track vendors, FedRAMP offerings, agencies, keywords, and NAICS codes. Attach
          alert rules below to get notified when something moves.
        </p>
        <div className="font-mono text-[12px] text-muted">
          TIER <span className="text-accent-gold">{tier}</span>
          {limits?.maxWatchlists !== null && (
            <> · {watchlists.length}/{limits?.maxWatchlists} lists</>
          )}
          {limits?.maxItemsPerWatchlist !== null && (
            <> · {limits?.maxItemsPerWatchlist} items per list</>
          )}
          {' · '}
          {limits?.frequencies.join(' / ')} alerts
        </div>
      </header>

      {error && (
        <div className="border border-accent-gold/40 bg-accent-gold/10 px-3 py-2 font-mono text-[13px] text-accent-gold">
          {error}
        </div>
      )}

      {/* Create */}
      <section className="border border-border rounded-lg bg-surface/40 p-4">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!newName.trim()) return
            const created = await call('/api/watchlists', {
              method: 'POST',
              body: JSON.stringify({ name: newName.trim() }),
            })
            if (created) setNewName('')
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New watchlist name"
            maxLength={80}
            className="flex-1 min-w-[200px] bg-background border border-border focus:border-accent-blue px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted/60 outline-none transition-colors"
          />
          <button
            type="submit"
            disabled={atWatchlistCap || !newName.trim()}
            className="px-3 py-2 font-mono text-xs tracking-[0.2em] text-accent-red border border-accent-red/40 hover:bg-accent-red/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            CREATE
          </button>
        </form>
        {atWatchlistCap && (
          <p className="mt-2 font-mono text-[12px] text-muted">
            {tier} tier is limited to {limits?.maxWatchlists} watchlist
            {limits?.maxWatchlists === 1 ? '' : 's'}. Upgrade to Pro for unlimited lists,
            daily digests, and realtime in-app alerts.
          </p>
        )}
      </section>

      {loading && <div className="font-mono text-xs text-muted">LOADING…</div>}

      {!loading && watchlists.length === 0 && (
        <div className="border border-border rounded-lg bg-surface/40 p-8 text-center">
          <div className="font-mono text-xs text-muted-foreground mb-2">NO WATCHLISTS YET</div>
          <p className="font-mono text-[13px] text-muted">
            Create one above, or hit <span className="text-accent-red">+ WATCH</span> on any{' '}
            <Link href="/vendors" className="text-accent-blue hover:underline">
              vendor page
            </Link>
            .
          </p>
        </div>
      )}

      {watchlists.map((list) => (
        <WatchlistCard
          key={list.id}
          list={list}
          rules={rules.filter((r) => r.watchlist?.id === list.id)}
          limits={limits}
          onCall={call}
        />
      ))}
    </div>
  )
}

function WatchlistCard({
  list,
  rules,
  limits,
  onCall,
}: {
  list: Watchlist
  rules: Rule[]
  limits: Limits | null
  onCall: (url: string, init: RequestInit) => Promise<boolean>
}) {
  const [adding, setAdding] = useState(false)
  const [targetType, setTargetType] = useState<TargetType>('KEYWORD')
  const [targetValue, setTargetValue] = useState('')
  const [ruleType, setRuleType] = useState<RuleType>('NEW_CONTRACT')
  const [frequency, setFrequency] = useState<Frequency>('WEEKLY')

  const existingRuleTypes = new Set(rules.map((r) => r.ruleType))
  const availableRuleTypes = RULE_TYPES.filter((t) => !existingRuleTypes.has(t))

  const atItemCap =
    limits?.maxItemsPerWatchlist !== null &&
    limits?.maxItemsPerWatchlist !== undefined &&
    list.items.length >= limits.maxItemsPerWatchlist

  return (
    <section className="border border-border rounded-lg bg-surface/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-mono text-xs tracking-[0.15em] text-foreground uppercase">
          {list.name}
        </h2>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-muted">
            {list.items.length} item{list.items.length === 1 ? '' : 's'} · {rules.length} rule
            {rules.length === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => {
              if (confirm(`Delete watchlist "${list.name}" and its alert rules?`)) {
                void onCall(`/api/watchlists/${list.id}`, { method: 'DELETE' })
              }
            }}
            className="font-mono text-[12px] tracking-wider text-muted hover:text-accent-red transition-colors"
          >
            DELETE
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Items */}
        <div>
          <div className="font-mono text-[12px] tracking-[0.2em] text-muted mb-2">TARGETS</div>
          {list.items.length === 0 ? (
            <p className="font-mono text-[13px] text-muted">
              Nothing tracked yet. Rules on an empty list are skipped.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {list.items.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-2 px-2 py-1 rounded border border-border bg-background font-mono text-[12px]"
                >
                  <span className="text-muted">{TARGET_LABELS[item.targetType]}</span>
                  <span className="text-foreground">
                    {item.label || item.targetValue || item.targetId}
                  </span>
                  <button
                    onClick={() =>
                      onCall(`/api/watchlists/${list.id}/items?itemId=${item.id}`, {
                        method: 'DELETE',
                      })
                    }
                    className="text-muted hover:text-accent-red transition-colors"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {adding ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (!targetValue.trim()) return
                const added = await onCall(`/api/watchlists/${list.id}/items`, {
                  method: 'POST',
                  body: JSON.stringify({
                    targetType,
                    targetValue: targetValue.trim(),
                    label: targetValue.trim(),
                  }),
                })
                if (added) {
                  setTargetValue('')
                  setAdding(false)
                }
              }}
              className="mt-3 flex flex-wrap items-center gap-2"
            >
              <select
                value={targetType}
                onChange={(e) => setTargetType(e.target.value as TargetType)}
                className="bg-background border border-border px-2 py-1.5 font-mono text-[13px] text-foreground outline-none"
              >
                {(['FEDRAMP_CSO', 'AGENCY', 'KEYWORD', 'NAICS'] as TargetType[]).map((t) => (
                  <option key={t} value={t}>
                    {TARGET_LABELS[t]}
                  </option>
                ))}
              </select>
              <input
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder={
                  targetType === 'AGENCY'
                    ? 'e.g. Department of the Air Force'
                    : targetType === 'NAICS'
                      ? 'e.g. 541512'
                      : targetType === 'FEDRAMP_CSO'
                        ? 'FedRAMP package ID'
                        : 'e.g. counter-UAS'
                }
                className="flex-1 min-w-[180px] bg-background border border-border focus:border-accent-blue px-2 py-1.5 font-mono text-[13px] text-foreground placeholder:text-muted/60 outline-none"
              />
              <button
                type="submit"
                className="px-2 py-1.5 font-mono text-[12px] tracking-wider text-accent-red border border-accent-red/40 hover:bg-accent-red/10 transition-colors"
              >
                ADD
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="px-2 py-1.5 font-mono text-[12px] tracking-wider text-muted hover:text-foreground transition-colors"
              >
                CANCEL
              </button>
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              disabled={atItemCap}
              className="mt-3 px-2 py-1 font-mono text-[12px] tracking-wider text-muted-foreground border border-border hover:border-border-bright hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              + ADD TARGET
            </button>
          )}
          {atItemCap && (
            <p className="mt-2 font-mono text-[12px] text-muted">
              Item cap reached ({limits?.maxItemsPerWatchlist}). Vendors can still be added
              from vendor pages once you free a slot.
            </p>
          )}
        </div>

        {/* Rules */}
        <div className="border-t border-border pt-4">
          <div className="font-mono text-[12px] tracking-[0.2em] text-muted mb-2">ALERT RULES</div>

          {rules.length > 0 && (
            <div className="space-y-2 mb-3">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded border border-border bg-background"
                >
                  <div className="font-mono text-[13px]">
                    <span className={rule.active ? 'text-foreground' : 'text-muted line-through'}>
                      {RULE_LABELS[rule.ruleType as RuleType] || rule.ruleType}
                    </span>
                    <span className="text-muted ml-2">
                      {rule.frequency} · {rule.channel} · {rule.eventCount} fired
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() =>
                        onCall(`/api/alerts/rules/${rule.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ active: !rule.active }),
                        })
                      }
                      className="font-mono text-[12px] tracking-wider text-muted hover:text-foreground transition-colors"
                    >
                      {rule.active ? 'PAUSE' : 'RESUME'}
                    </button>
                    <button
                      onClick={() =>
                        onCall(`/api/alerts/rules/${rule.id}`, { method: 'DELETE' })
                      }
                      className="font-mono text-[12px] tracking-wider text-muted hover:text-accent-red transition-colors"
                    >
                      DELETE
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {availableRuleTypes.length > 0 ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void onCall('/api/alerts/rules', {
                  method: 'POST',
                  body: JSON.stringify({
                    ruleType,
                    watchlistId: list.id,
                    frequency,
                    channel: 'EMAIL',
                  }),
                })
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <select
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as RuleType)}
                className="bg-background border border-border px-2 py-1.5 font-mono text-[13px] text-foreground outline-none"
              >
                {availableRuleTypes.map((t) => (
                  <option key={t} value={t}>
                    {RULE_LABELS[t]}
                  </option>
                ))}
              </select>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
                className="bg-background border border-border px-2 py-1.5 font-mono text-[13px] text-foreground outline-none"
              >
                {FREQUENCIES.map((f) => {
                  const allowed = limits?.frequencies.includes(f) ?? f === 'WEEKLY'
                  return (
                    <option key={f} value={f} disabled={!allowed}>
                      {f}
                      {allowed ? '' : ' (Pro)'}
                    </option>
                  )
                })}
              </select>
              <button
                type="submit"
                className="px-2 py-1.5 font-mono text-[12px] tracking-wider text-accent-red border border-accent-red/40 hover:bg-accent-red/10 transition-colors"
              >
                + ADD RULE
              </button>
              <span className="font-mono text-[12px] text-muted">
                matches {RULE_TARGETS[ruleType].map((t) => TARGET_LABELS[t]).join(', ')}
              </span>
            </form>
          ) : (
            <p className="font-mono text-[12px] text-muted">
              All rule types are already attached to this list.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
