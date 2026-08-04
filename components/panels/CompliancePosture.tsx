'use client'

import { useEffect, useState } from 'react'
import type { Crosswalk } from '@/lib/compliance/crosswalk'
import { SET_ASIDE_LABELS } from '@/lib/compliance/shared'

/**
 * "Compliance Posture" panel for the vendor dossier — the crosswalk rendered as
 * an authorization timeline, an agency leverage map, and assessment countdowns.
 */

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function levelClass(level: string | null): string {
  if (!level) return 'text-muted border-border'
  if (level === 'High' || level === 'IL5' || level === 'IL6')
    return 'text-accent-red border-accent-red/40'
  if (level.includes('Moderate') || level === 'IL4')
    return 'text-accent-gold border-accent-gold/40'
  return 'text-accent-blue border-accent-blue/40'
}

function countdownClass(days: number | null): string {
  if (days === null) return 'text-muted'
  if (days < 0) return 'text-accent-red'
  if (days <= 30) return 'text-accent-red'
  if (days <= 90) return 'text-accent-gold'
  return 'text-accent-green'
}

function countdownLabel(days: number | null): string {
  if (days === null) return 'no date'
  if (days < 0) return `${Math.abs(days)}d overdue`
  return `${days}d`
}

export default function CompliancePosture({ slug }: { slug: string }) {
  const [data, setData] = useState<Crosswalk | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/compliance/crosswalk?entity=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((res) => {
        if (cancelled) return
        const crosswalk: Crosswalk | undefined = res?.data
        if (!crosswalk) return setState('error')
        setData(crosswalk)
        setState(crosswalk.authorizations.summary.total === 0 ? 'empty' : 'ready')
      })
      .catch(() => !cancelled && setState('error'))
    return () => {
      cancelled = true
    }
  }, [slug])

  if (state === 'loading') {
    return (
      <section className="border border-border rounded-lg bg-surface/40 p-4">
        <div className="font-mono text-xs text-muted">LOADING COMPLIANCE POSTURE…</div>
      </section>
    )
  }

  if (state === 'error' || !data) return null

  if (state === 'empty') {
    return (
      <section className="border border-border rounded-lg bg-surface/40 overflow-hidden">
        <Header />
        <div className="p-4">
          <p className="font-mono text-[11px] text-muted leading-relaxed">
            No FedRAMP, DoD provisional, or eMASS authorization on record for this vendor.
            That is a finding in itself: an unauthorized vendor cannot host federal
            workloads at any impact level without sponsorship.
          </p>
        </div>
      </section>
    )
  }

  const { authorizations, agencyLeverage, spend, entity } = data
  const timeline = [
    ...authorizations.fedramp.map((f) => ({
      key: `f-${f.packageId}`,
      name: f.csoName,
      kind: 'FedRAMP',
      level: f.impactLevel,
      status: f.status,
      start: f.authorizationDate,
      due: f.expirationDate,
      days: f.daysRemaining,
      agency: f.sponsoringAgency,
      provisional: f.matchedByName,
    })),
    ...authorizations.dodPa.map((d) => ({
      key: `d-${d.id}`,
      name: d.csoName,
      kind: 'DoD PA',
      level: d.impactLevel,
      status: 'Authorized',
      start: d.paDate,
      due: d.paExpiration,
      days: d.daysRemaining,
      agency: d.sponsorComponent,
      provisional: d.matchedByName,
    })),
    ...authorizations.emass.map((e) => ({
      key: `e-${e.id}`,
      name: e.systemName,
      kind: `eMASS ${e.authorizationType}`,
      level: e.impactLevel,
      status: e.authorizationType,
      start: e.authorizationDate,
      due: e.expirationDate,
      days: e.daysRemaining,
      agency: e.component,
      provisional: e.matchedByName,
    })),
  ].sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''))

  const maxObligated = Math.max(1, ...agencyLeverage.map((a) => a.totalObligated))

  return (
    <section className="border border-border rounded-lg bg-surface/40 overflow-hidden">
      <Header />

      <div className="p-4 space-y-5">
        {/* Summary strip */}
        <div className="flex flex-wrap gap-5">
          <Stat label="Authorizations" value={String(authorizations.summary.total)} />
          <Stat label="Active" value={String(authorizations.summary.active)} tone="green" />
          <Stat
            label="Highest level"
            value={authorizations.summary.highestImpactLevel || '—'}
            tone="red"
          />
          <Stat
            label="Due ≤90d"
            value={String(authorizations.summary.expiringWithin90)}
            tone={authorizations.summary.expiringWithin90 > 0 ? 'gold' : 'muted'}
          />
          <Stat
            label="Federal obligated"
            value={data.spendDataAvailable ? money(spend.totalFederalObligated) : 'not enriched'}
          />
        </div>

        {data.whitespace && (
          <div className="border border-accent-gold/40 bg-accent-gold/10 px-3 py-2 font-mono text-[10px] text-accent-gold leading-relaxed">
            WHITESPACE — authorized to operate, but no federal obligations on record.
            Cleared the hardest gate and winning nothing.
          </div>
        )}

        {!data.spendDataAvailable && (
          <div className="border border-border bg-background px-3 py-2 font-mono text-[10px] text-muted leading-relaxed">
            Spend figures are unavailable — vendor enrichment has not run for this entity, so
            obligations are unknown rather than zero.
          </div>
        )}

        {/* Authorization timeline */}
        <div>
          <SubHeading>AUTHORIZATION TIMELINE</SubHeading>
          <div className="space-y-1.5">
            {timeline.map((t) => (
              <div
                key={t.key}
                className="flex flex-wrap items-center gap-2 px-2.5 py-2 rounded border border-border bg-background"
              >
                <span
                  className={`px-1.5 py-0.5 rounded border font-mono text-[9px] shrink-0 ${levelClass(t.level)}`}
                >
                  {t.level || '—'}
                </span>
                <span className="font-mono text-[10px] text-muted shrink-0 w-[70px]">{t.kind}</span>
                <span className="font-mono text-[11px] text-foreground flex-1 min-w-[140px] truncate" title={t.name}>
                  {t.name}
                </span>
                {t.agency && (
                  <span className="font-mono text-[9px] text-muted-foreground truncate max-w-[180px]" title={t.agency}>
                    {t.agency}
                  </span>
                )}
                <span className="font-mono text-[9px] text-muted shrink-0">
                  {t.start ? t.start.slice(0, 10) : '—'}
                </span>
                <span className={`font-mono text-[10px] shrink-0 w-[80px] text-right ${countdownClass(t.days)}`}>
                  {countdownLabel(t.days)}
                </span>
                {t.provisional && (
                  <span
                    className="font-mono text-[9px] text-accent-gold shrink-0"
                    title="Matched by name — not yet confirmed against a resolved entity link"
                  >
                    ~
                  </span>
                )}
              </div>
            ))}
          </div>
          {timeline.some((t) => t.provisional) && (
            <p className="mt-2 font-mono text-[9px] text-muted">
              ~ matched by vendor name only; entity link not yet confirmed.
            </p>
          )}
        </div>

        {/* Agency leverage map */}
        {agencyLeverage.length > 0 && (
          <div>
            <SubHeading>AGENCY LEVERAGE</SubHeading>
            <div className="space-y-1">
              {agencyLeverage.slice(0, 12).map((a) => (
                <div key={a.agency} className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-foreground w-[220px] truncate" title={a.agency}>
                    {a.agency}
                  </span>
                  <div className="flex-1 h-3 bg-background rounded-sm overflow-hidden min-w-[60px]">
                    <div
                      className="h-full bg-accent-blue/50"
                      style={{ width: `${Math.max(2, (a.totalObligated / maxObligated) * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground w-[64px] text-right">
                    {a.totalObligated > 0 ? money(a.totalObligated) : '—'}
                  </span>
                  <span className="flex gap-1 w-[130px] shrink-0">
                    {a.roles.map((r) => (
                      <span
                        key={r}
                        className={`px-1 py-0.5 rounded font-mono text-[8px] ${
                          r === 'obligations'
                            ? 'bg-accent-green/10 text-accent-green'
                            : r === 'sponsor'
                              ? 'bg-accent-red/10 text-accent-red'
                              : 'bg-surface text-muted'
                        }`}
                      >
                        {r === 'obligations' ? 'BUYS' : r.toUpperCase()}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 font-mono text-[9px] text-muted leading-relaxed">
              SPONSOR = granted the authorization · LEVERAGING = reusing someone else&apos;s ·
              BUYS = actually obligating money. An agency that sponsors but doesn&apos;t buy is
              the gap worth a call.
            </p>
          </div>
        )}

        {/* Set-asides and risk */}
        {(entity.setAsides.length > 0 || entity.riskFlags.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {entity.setAsides.map((s) => (
              <span
                key={s}
                className="px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green font-mono text-[9px]"
              >
                {SET_ASIDE_LABELS[s] || s}
              </span>
            ))}
            {entity.riskFlags.map((f) => (
              <span
                key={f}
                className="px-1.5 py-0.5 rounded bg-accent-red/10 text-accent-red font-mono text-[9px]"
              >
                {f.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Header() {
  return (
    <div className="px-4 py-3 border-b border-border flex items-baseline justify-between gap-3">
      <h2 className="font-mono text-xs tracking-[0.15em] text-foreground uppercase">
        Compliance Posture
      </h2>
      <span className="font-mono text-[10px] text-muted">FedRAMP · DoD PA · eMASS</span>
    </div>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-[0.2em] text-muted mb-2">{children}</div>
  )
}

function Stat({
  label,
  value,
  tone = 'foreground',
}: {
  label: string
  value: string
  tone?: 'foreground' | 'green' | 'red' | 'gold' | 'muted'
}) {
  const toneClass = {
    foreground: 'text-foreground',
    green: 'text-accent-green',
    red: 'text-accent-red',
    gold: 'text-accent-gold',
    muted: 'text-muted',
  }[tone]
  return (
    <div className="min-w-[100px]">
      <div className={`font-mono text-base ${toneClass}`}>{value}</div>
      <div className="text-[9px] text-muted font-mono uppercase tracking-wider mt-0.5">
        {label}
      </div>
    </div>
  )
}
