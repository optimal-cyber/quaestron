'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function AccountClient({
  email,
  tier,
  role,
  initialOptIn,
}: {
  email: string | null
  tier: string
  role: string
  initialOptIn: boolean
}) {
  const [optIn, setOptIn] = useState(initialOptIn)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function toggle() {
    setSaving(true)
    setStatus(null)
    const next = !optIn
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertEmailOptIn: next }),
      })
      const json = await res.json()
      if (!res.ok) {
        setStatus(json?.error || 'Could not save')
        return
      }
      setOptIn(next)
      setStatus(next ? 'Alert email enabled.' : 'Alert email disabled.')
    } catch {
      setStatus('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[10px] tracking-[0.3em] text-muted">OPERATOR PROFILE</div>
        <h1 className="font-mono text-2xl tracking-[0.08em] text-foreground uppercase">
          <span className="text-accent-red">&#x276E;</span> ACCOUNT
        </h1>
      </header>

      <section className="border border-border rounded-lg bg-surface/40 p-4 space-y-3">
        <Row label="EMAIL" value={email || '—'} />
        <Row label="TIER" value={tier} accent="text-accent-gold" />
        {role === 'ADMIN' && <Row label="ROLE" value="ADMIN" accent="text-accent-red" />}
      </section>

      <section className="border border-border rounded-lg bg-surface/40 p-4">
        <div className="font-mono text-[10px] tracking-[0.2em] text-muted mb-3">
          NOTIFICATIONS
        </div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-sm">
            <div className="font-mono text-xs text-foreground">Alert digest email</div>
            <p className="font-mono text-[10px] text-muted mt-1 leading-relaxed">
              Turning this off stops digest email entirely. Alerts still collect in your{' '}
              <Link href="/alerts" className="text-accent-blue hover:underline">
                in-app inbox
              </Link>
              .
            </p>
          </div>
          <button
            onClick={toggle}
            disabled={saving}
            className={`px-3 py-1.5 font-mono text-[10px] tracking-wider rounded border transition-colors disabled:opacity-50 ${
              optIn
                ? 'text-accent-green border-accent-green/40 hover:bg-accent-green/10'
                : 'text-muted border-border hover:border-border-bright'
            }`}
          >
            {saving ? '…' : optIn ? 'ENABLED' : 'DISABLED'}
          </button>
        </div>
        {status && (
          <p className="mt-3 font-mono text-[10px] text-muted-foreground">{status}</p>
        )}
      </section>

      <section className="border border-border rounded-lg bg-surface/40 p-4">
        <div className="font-mono text-[10px] tracking-[0.2em] text-muted mb-3">TIER LIMITS</div>
        <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
          {tier === 'FREE'
            ? 'Free: 1 watchlist, 5 tracked targets, weekly digest. Pro adds unlimited watchlists, daily digests, and realtime in-app alerts.'
            : `${tier}: unlimited watchlists and targets, weekly + daily digests, realtime in-app alerts.`}
        </p>
      </section>
    </div>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="font-mono text-[10px] tracking-[0.2em] text-muted">{label}</span>
      <span className={`font-mono text-xs ${accent || 'text-foreground'} truncate`}>{value}</span>
    </div>
  )
}
