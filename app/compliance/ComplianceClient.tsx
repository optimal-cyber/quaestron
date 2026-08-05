'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { RISK_FLAG_LABELS, SET_ASIDE_LABELS } from '@/lib/compliance/shared'
import type { ComplianceRow } from '@/lib/compliance/universe'
import type { ComplianceInsights } from '@/lib/compliance/insights'
import AskAnalystButton from '@/components/AskAnalystButton'

interface Facets {
  impactLevels: string[]
  statuses: string[]
  agencies: string[]
}

interface Totals {
  fedrampTotal: number
  fedrampAuthorized: number
  dodPaTotal: number
  emassTotal: number
}

const SET_ASIDE_OPTIONS = ['SDVOSB', '8A', 'WOSB', 'HUBZONE', 'WOMAN_OWNED', 'VETERAN_OWNED']

const EXPIRY_WINDOWS = [
  { label: 'Any', value: '' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
  { label: '180 days', value: '180' },
  { label: '1 year', value: '365' },
]

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function levelClass(level: string | null): string {
  if (!level) return 'text-muted border-border'
  if (level === 'High' || level === 'IL5' || level === 'IL6')
    return 'text-accent-red border-accent-red/40'
  if (level.includes('Moderate') || level === 'IL4')
    return 'text-accent-gold border-accent-gold/40'
  return 'text-accent-blue border-accent-blue/40'
}

function daysClass(days: number | null): string {
  if (days === null) return 'text-muted'
  if (days <= 30) return 'text-accent-red'
  if (days <= 90) return 'text-accent-gold'
  return 'text-muted-foreground'
}

export default function ComplianceClient() {
  const [rows, setRows] = useState<ComplianceRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [insights, setInsights] = useState<ComplianceInsights | null>(null)

  const [search, setSearch] = useState('')
  const [impactLevel, setImpactLevel] = useState('')
  const [status, setStatus] = useState('')
  const [agency, setAgency] = useState('')
  const [businessSize, setBusinessSize] = useState('')
  const [setAside, setSetAside] = useState('')
  const [expiring, setExpiring] = useState('')
  const [source, setSource] = useState('')
  const [sort, setSort] = useState('expiration')

  const limit = 50

  const load = useCallback(
    async (targetPage: number, withFacets: boolean) => {
      setLoading(true)
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (impactLevel) params.set('impactLevel', impactLevel)
      if (status) params.set('status', status)
      if (agency) params.set('agency', agency)
      if (businessSize) params.set('businessSize', businessSize)
      if (setAside) params.set('setAside', setAside)
      if (expiring) params.set('expiringWithinDays', expiring)
      if (source) params.set('source', source)
      params.set('sort', sort)
      params.set('page', String(targetPage))
      params.set('limit', String(limit))
      if (withFacets) params.set('facets', '1')

      try {
        const res = await fetch(`/api/compliance?${params}`).then((r) => r.json())
        if (res?.data) {
          setRows(res.data.rows)
          setTotal(res.data.total)
          setPage(res.data.page)
          if (res.data.facets) setFacets(res.data.facets)
          if (res.data.totals) setTotals(res.data.totals)
        }
      } finally {
        setLoading(false)
      }
    },
    [search, impactLevel, status, agency, businessSize, setAside, expiring, source, sort]
  )

  // First load pulls facets and insights; filter changes reload rows only.
  useEffect(() => {
    void load(1, !facets)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  useEffect(() => {
    fetch('/api/compliance/insights')
      .then((r) => r.json())
      .then((res) => res?.data && setInsights(res.data))
      .catch(() => {})
  }, [])

  const pageCount = Math.max(1, Math.ceil(total / limit))
  const activeFilters =
    [search, impactLevel, status, agency, businessSize, setAside, expiring, source].filter(Boolean)
      .length

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-5">
      <header className="space-y-2">
        <div className="font-mono text-[10px] tracking-[0.3em] text-muted">
          COMPLIANCE INTELLIGENCE
        </div>
        <h1 className="font-mono text-2xl md:text-3xl tracking-[0.08em] text-foreground uppercase">
          <span className="text-accent-red">&#x276E;</span> AUTHORIZED CLOUD UNIVERSE
        </h1>
        <p className="font-mono text-[11px] text-muted-foreground max-w-3xl leading-relaxed">
          Every FedRAMP authorization and DoD provisional authorization, joined to the
          vendor&apos;s federal contract history. Who is cleared to operate, at what impact
          level, for which agency — and whether they are actually winning work there.
        </p>
        {totals && (
          <div className="flex flex-wrap gap-4 pt-1 font-mono text-[10px] text-muted">
            <span>
              FEDRAMP <span className="text-foreground">{totals.fedrampTotal}</span>
            </span>
            <span>
              AUTHORIZED <span className="text-accent-green">{totals.fedrampAuthorized}</span>
            </span>
            <span>
              DOD PA <span className="text-foreground">{totals.dodPaTotal}</span>
            </span>
            <span>
              EMASS <span className="text-foreground">{totals.emassTotal}</span>
            </span>
          </div>
        )}
      </header>

      {insights && <InsightCards insights={insights} onFilter={(days) => setExpiring(days)} />}

      {/* Filters */}
      <section className="border border-border rounded-lg bg-surface/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor or offering…"
            className="flex-1 min-w-[200px] bg-background border border-border focus:border-accent-blue px-3 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted/60 outline-none transition-colors"
          />
          <Select value={impactLevel} onChange={setImpactLevel} label="All levels">
            {(facets?.impactLevels ?? []).map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={setStatus} label="All statuses">
            {(facets?.statuses ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select value={agency} onChange={setAgency} label="All agencies">
            {(facets?.agencies ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          <Select value={businessSize} onChange={setBusinessSize} label="Any size">
            <option value="SMALL">Small business</option>
            <option value="OTHER">Other than small</option>
          </Select>
          <Select value={setAside} onChange={setSetAside} label="Any set-aside">
            {SET_ASIDE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {SET_ASIDE_LABELS[s] || s}
              </option>
            ))}
          </Select>
          <Select value={expiring} onChange={setExpiring} label="Assessment due: any">
            {EXPIRY_WINDOWS.filter((w) => w.value).map((w) => (
              <option key={w.value} value={w.value}>
                Due within {w.label}
              </option>
            ))}
          </Select>
          <Select value={source} onChange={setSource} label="All sources">
            <option value="fedramp">FedRAMP</option>
            <option value="dod-pa">DoD PA</option>
          </Select>
          <Select value={sort} onChange={setSort} label="Sort">
            <option value="expiration">Soonest due</option>
            <option value="level">Highest level</option>
            <option value="obligated">Most obligated</option>
            <option value="vendor">Vendor A–Z</option>
          </Select>
          {activeFilters > 0 && (
            <button
              onClick={() => {
                setSearch('')
                setImpactLevel('')
                setStatus('')
                setAgency('')
                setBusinessSize('')
                setSetAside('')
                setExpiring('')
                setSource('')
              }}
              className="px-2 py-1.5 font-mono text-[10px] tracking-wider text-accent-red border border-accent-red/40 hover:bg-accent-red/10 transition-colors"
            >
              CLEAR {activeFilters}
            </button>
          )}
        </div>
      </section>

      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="font-mono text-[10px] text-muted">
          {loading ? 'QUERYING…' : `${total} AUTHORIZATION${total === 1 ? '' : 'S'}`}
        </div>
        <div className="font-mono text-[9px] text-muted max-w-xl text-right leading-relaxed">
          FedRAMP has no hard expiry — the date shown is the next annual assessment due
          date, which is when an authorization lapses if unmet.
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg bg-surface/40 overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left">
          <thead>
            <tr className="border-b border-border">
              {['Vendor', 'Offering', 'Level', 'Status', 'Agencies', 'Federal $', 'Assessment due', 'Flags'].map(
                (h) => (
                  <th
                    key={h}
                    className="px-3 py-2 font-mono text-[9px] tracking-[0.18em] text-muted uppercase whitespace-nowrap"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="border-b border-border/50 hover:bg-surface-hover/50 transition-colors"
              >
                <td className="px-3 py-2">
                  {row.entity ? (
                    <Link
                      href={`/vendor/${row.entity.slug}`}
                      className="font-mono text-[11px] text-accent-blue hover:underline"
                    >
                      {row.vendor}
                    </Link>
                  ) : (
                    <span className="font-mono text-[11px] text-muted-foreground" title="Not yet linked to a tracked vendor">
                      {row.vendor}
                    </span>
                  )}
                  {row.smallBusiness && (
                    <span className="ml-2 font-mono text-[9px] text-accent-green">SB</span>
                  )}
                  {row.entity && (
                    <span className="ml-2 inline-block align-middle">
                      <AskAnalystButton slug={row.entity.slug} name={row.entity.name} compact />
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-foreground max-w-[280px] truncate" title={row.offering}>
                  {row.offering}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`px-1.5 py-0.5 rounded border font-mono text-[9px] whitespace-nowrap ${levelClass(row.impactLevel)}`}
                  >
                    {row.impactLevel || '—'}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                  {row.status}
                  <span className="ml-1.5 text-muted">
                    {row.source === 'dod-pa' ? 'DoD' : ''}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                  {row.sponsoringAgency ? (
                    <span title={`Sponsor: ${row.sponsoringAgency}`}>
                      {row.sponsoringAgency.length > 28
                        ? row.sponsoringAgency.slice(0, 28) + '…'
                        : row.sponsoringAgency}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                  {row.leveragingCount > 0 && (
                    <span
                      className="ml-1.5 text-accent-blue"
                      title={row.leveragingAgencies.join('\n')}
                    >
                      +{row.leveragingCount}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-foreground whitespace-nowrap">
                  {row.entity ? money(row.entity.totalFederalObligated) : '—'}
                </td>
                <td className={`px-3 py-2 font-mono text-[10px] whitespace-nowrap ${daysClass(row.daysRemaining)}`}>
                  {row.daysRemaining !== null
                    ? `${row.daysRemaining}d`
                    : <span className="text-muted">—</span>}
                  {row.expirationDate && (
                    <span className="ml-1.5 text-muted">
                      {row.expirationDate.slice(0, 10)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(row.entity?.riskFlags ?? []).map((f) => (
                      <span
                        key={f}
                        className="px-1 py-0.5 rounded bg-accent-red/10 text-accent-red font-mono text-[9px] whitespace-nowrap"
                        title={RISK_FLAG_LABELS[f] || f}
                      >
                        {RISK_FLAG_LABELS[f] || f}
                      </span>
                    ))}
                    {(row.entity?.setAsides ?? []).slice(0, 2).map((s) => (
                      <span
                        key={s}
                        className="px-1 py-0.5 rounded bg-accent-green/10 text-accent-green font-mono text-[9px] whitespace-nowrap"
                      >
                        {SET_ASIDE_LABELS[s] || s}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center font-mono text-[11px] text-muted">
                  No authorizations match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => load(page - 1, false)}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 font-mono text-[10px] tracking-wider text-muted-foreground border border-border hover:border-border-bright hover:text-foreground disabled:opacity-40 transition-colors"
          >
            ← PREV
          </button>
          <span className="font-mono text-[10px] text-muted">
            PAGE {page} / {pageCount}
          </span>
          <button
            onClick={() => load(page + 1, false)}
            disabled={page >= pageCount || loading}
            className="px-3 py-1.5 font-mono text-[10px] tracking-wider text-muted-foreground border border-border hover:border-border-bright hover:text-foreground disabled:opacity-40 transition-colors"
          >
            NEXT →
          </button>
        </div>
      )}
    </div>
  )
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-background border px-2 py-1.5 font-mono text-[11px] outline-none transition-colors ${
        value ? 'border-accent-blue/50 text-foreground' : 'border-border text-muted-foreground'
      }`}
    >
      <option value="">{label}</option>
      {children}
    </select>
  )
}

function InsightCards({
  insights,
  onFilter,
}: {
  insights: ComplianceInsights
  onFilter: (days: string) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      <Card
        title="Expiring by agency"
        hint={`next ${insights.params.expiringWindowDays}d`}
        action={{ label: 'FILTER 180d', onClick: () => onFilter('180') }}
      >
        {insights.expiringByAgency.length === 0 ? (
          <Empty>No assessments due in this window.</Empty>
        ) : (
          insights.expiringByAgency.slice(0, 5).map((a) => (
            <Line
              key={a.agency}
              left={a.agency}
              right={`${a.expiringCount}`}
              sub={a.soonestDays !== null ? `soonest ${a.soonestDays}d` : undefined}
              tone={a.soonestDays !== null && a.soonestDays <= 30 ? 'red' : 'default'}
            />
          ))
        )}
      </Card>

      <Card title="Small business authorized" hint="highest level first">
        {insights.smallBusinessAuthorizations.length === 0 ? (
          <Empty>No small-business authorizations found.</Empty>
        ) : (
          insights.smallBusinessAuthorizations.slice(0, 5).map((s, i) => (
            <Line
              key={`${s.entitySlug}-${i}`}
              left={s.entityName}
              right={s.impactLevel || '—'}
              sub={s.setAsides.map((x) => SET_ASIDE_LABELS[x] || x).join(', ') || undefined}
              href={`/vendor/${s.entitySlug}`}
              tone="green"
            />
          ))
        )}
      </Card>

      <Card title="Whitespace" hint="authorized, $0 obligated">
        {insights.whitespace.length === 0 ? (
          <Empty>
            None found. Requires vendor enrichment to have run — an un-enriched vendor has
            unknown spend, not zero.
          </Empty>
        ) : (
          insights.whitespace.slice(0, 5).map((w, i) => (
            <Line
              key={`${w.entitySlug}-${i}`}
              left={w.entityName}
              right={w.impactLevel || '—'}
              sub={w.offering}
              href={`/vendor/${w.entitySlug}`}
              tone="gold"
            />
          ))
        )}
      </Card>

      <Card
        title="Newly authorized"
        hint={`last ${insights.params.newlyAuthorizedWindowDays}d`}
      >
        {insights.newlyAuthorized.length === 0 ? (
          <Empty>No new authorizations in this window.</Empty>
        ) : (
          insights.newlyAuthorized.slice(0, 5).map((n, i) => (
            <Line
              key={`${n.vendor}-${i}`}
              left={n.vendor}
              right={n.impactLevel || '—'}
              sub={n.authorizationDate?.slice(0, 10)}
              href={n.entitySlug ? `/vendor/${n.entitySlug}` : undefined}
            />
          ))
        )}
      </Card>
    </div>
  )
}

function Card({
  title,
  hint,
  action,
  children,
}: {
  title: string
  hint?: string
  action?: { label: string; onClick: () => void }
  children: React.ReactNode
}) {
  return (
    <section className="border border-border rounded-lg bg-surface/40 overflow-hidden flex flex-col">
      <div className="px-3 py-2 border-b border-border flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-[10px] tracking-[0.15em] text-foreground uppercase">
          {title}
        </h2>
        {hint && <span className="font-mono text-[9px] text-muted">{hint}</span>}
      </div>
      <div className="p-2 space-y-1 flex-1">{children}</div>
      {action && (
        <button
          onClick={action.onClick}
          className="px-3 py-1.5 border-t border-border font-mono text-[9px] tracking-wider text-accent-blue hover:bg-accent-blue/10 transition-colors text-left"
        >
          {action.label} →
        </button>
      )}
    </section>
  )
}

function Line({
  left,
  right,
  sub,
  href,
  tone = 'default',
}: {
  left: string
  right: string
  sub?: string
  href?: string
  tone?: 'default' | 'red' | 'green' | 'gold'
}) {
  const toneClass =
    tone === 'red'
      ? 'text-accent-red'
      : tone === 'green'
        ? 'text-accent-green'
        : tone === 'gold'
          ? 'text-accent-gold'
          : 'text-muted-foreground'

  const content = (
    <div className="flex items-baseline justify-between gap-2 px-1.5 py-1 rounded hover:bg-surface-hover/50 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[11px] text-foreground truncate">{left}</div>
        {sub && <div className="font-mono text-[9px] text-muted truncate">{sub}</div>}
      </div>
      <div className={`font-mono text-[10px] shrink-0 ${toneClass}`}>{right}</div>
    </div>
  )

  return href ? <Link href={href}>{content}</Link> : content
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1.5 py-2 font-mono text-[9px] text-muted leading-relaxed">{children}</p>
  )
}
