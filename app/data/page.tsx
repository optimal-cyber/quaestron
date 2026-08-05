import type { Metadata } from 'next'
import Link from 'next/link'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import { buildCoverageStats } from '@/lib/coverage'

export const metadata: Metadata = {
  title: 'Data Coverage — Iron Echelon',
  description:
    'Live coverage statistics for Iron Echelon: tracked entities, federal contract awards, FedRAMP and DoD authorizations, and per-source sync timestamps. Every figure is computed from the database at request time.',
  openGraph: {
    title: 'Data Coverage — Iron Echelon',
    description:
      'Every number on this page is queried live. Tracked entities, contract awards, authorizations, and last-sync times per source.',
  },
}

/**
 * Public credibility page.
 *
 * Rendered per request, deliberately NOT prerendered at build. Build-time
 * prerendering issues these queries during `next build`, which couples every
 * deploy to the database's schema being current — a migration that hasn't run
 * yet fails the build outright rather than degrading one figure. Since the
 * queries are counts and the page is not hot, per-request is the right trade.
 */
export const dynamic = 'force-dynamic'

/** `-1` is the sentinel `safeCount` returns when a query fails. */
function num(n: number): string {
  return n < 0 ? 'unavailable' : n.toLocaleString('en-US')
}

function money(v: number): string {
  if (v < 0) return 'unavailable'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${num(Math.round(v))}`
}

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hours < 1) return 'under an hour ago'
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default async function DataPage() {
  const stats = await buildCoverageStats()

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav />
      <div className="flex-1 pt-12 pb-7 bg-background overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
          <header className="space-y-2">
            <div className="font-mono text-[10px] tracking-[0.3em] text-muted">COVERAGE</div>
            <h1 className="font-mono text-2xl md:text-3xl tracking-[0.08em] text-foreground uppercase">
              <span className="text-accent-red">&#x276E;</span> WHAT WE ACTUALLY HAVE
            </h1>
            <p className="font-mono text-[11px] text-muted-foreground max-w-2xl leading-relaxed">
              Every number on this page is queried from the database on each request —
              nothing is hardcoded or rounded up. Where coverage is partial or a figure
              is unavailable, it says so. Computed at{' '}
              {new Date(stats.generatedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC.
            </p>
          </header>

          {/* Headline */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Tracked entities" value={num(stats.entities.total)} tone="foreground" />
            <Stat label="Contract awards" value={num(stats.contracts.total)} tone="accent-blue" />
            <Stat
              label="Authorizations"
              value={num(
                [
                  stats.compliance.fedrampTotal,
                  stats.compliance.dodPaTotal,
                  stats.compliance.emassTotal,
                ].some((n) => n < 0)
                  ? -1
                  : stats.compliance.fedrampTotal +
                      stats.compliance.dodPaTotal +
                      stats.compliance.emassTotal
              )}
              tone="accent-green"
            />
            <Stat
              label="Obligations tracked"
              value={money(stats.contracts.totalValue)}
              tone="accent-gold"
            />
          </section>

          <Card title="Entities" hint="companies, agencies, and investors">
            <Row label="Total" value={num(stats.entities.total)} />
            <Row label="Vendors" value={num(stats.entities.vendors)} />
            <Row label="Government agencies" value={num(stats.entities.agencies)} />
            <Row label="Investors" value={num(stats.entities.investors)} />
            <Row
              label="Fully enriched (SAM, spend, set-asides)"
              value={`${num(stats.entities.enriched)} of ${num(stats.entities.total)}`}
              note={
                stats.entities.enriched >= 0 && stats.entities.enriched < stats.entities.total
                  ? 'Enrichment runs on demand and on a weekly rotation. Un-enriched vendors have unknown spend, not zero.'
                  : null
              }
            />
            <Row label="Countries mapped" value={num(stats.entities.countries)} />
          </Card>

          <Card title="Federal contracts" hint="USASpending.gov + SBIR.gov">
            <Row label="Award records" value={num(stats.contracts.total)} />
            <Row label="Total obligated across those awards" value={money(stats.contracts.totalValue)} />
            <Row
              label="Awards carrying a dollar figure"
              value={
                stats.contracts.total < 0
                  ? 'unavailable'
                  : `${Math.round(stats.contracts.valueCoverage * 100)}%`
              }
              note={
                stats.contracts.total > 0 && stats.contracts.valueCoverage < 0.95
                  ? 'The total above only sums awards that carry a value; the rest are counted but not priced.'
                  : null
              }
            />
            <Row label="SBIR/STTR awards" value={num(stats.contracts.sbirAwards)} />
            <Row label="SBIR/STTR value" value={money(stats.contracts.sbirValue)} />
            <Row label="Raw USASpending rows" value={num(stats.contracts.federalContractRows)} />
          </Card>

          <Card title="Compliance" hint="FedRAMP · DoD provisional · eMASS">
            <Row label="FedRAMP records" value={num(stats.compliance.fedrampTotal)} />
            <Row label="— of which authorized" value={num(stats.compliance.fedrampAuthorized)} />
            <Row
              label="— resolved to a tracked vendor"
              value={`${num(stats.compliance.fedrampLinked)} of ${num(stats.compliance.fedrampTotal)}`}
              note={
                stats.compliance.pendingMatchReviews > 0
                  ? `${stats.compliance.pendingMatchReviews} vendor name(s) awaiting manual review. The matcher refuses ambiguous names rather than guessing.`
                  : null
              }
            />
            <Row label="DoD provisional authorizations" value={num(stats.compliance.dodPaTotal)} />
            <Row label="eMASS system authorizations" value={num(stats.compliance.emassTotal)} />
            <Row
              label="Annual assessments due within 90 days"
              value={num(stats.compliance.assessmentsDue90)}
              note="FedRAMP authorizations do not hard-expire; they lapse if the annual assessment is unmet."
            />
          </Card>

          <Card title="Relationships and context">
            <Row label="Entity relationships" value={num(stats.relationships.connections)} />
            <Row label="Funding rounds" value={num(stats.relationships.fundingRounds)} />
            <Row label="SAM.gov registrations" value={num(stats.relationships.samRegistrations)} />
            <Row label="Lobbying filings" value={num(stats.relationships.lobbyingFilings)} />
            <Row label="News items" value={num(stats.relationships.newsItems)} />
          </Card>

          <Card title="Ingest freshness" hint="last successful sync per source">
            {stats.sources.length === 0 ? (
              <p className="font-mono text-[11px] text-muted">No sync has been recorded yet.</p>
            ) : (
              stats.sources.map((s) => (
                <Row
                  key={s.source}
                  label={s.label}
                  value={ago(s.lastSyncAt)}
                  note={
                    s.status && s.status !== 'success'
                      ? `Last run status: ${s.status}`
                      : `${num(s.records)} records touched`
                  }
                />
              ))
            )}
          </Card>

          <p className="font-mono text-[10px] text-muted leading-relaxed">
            Methodology: counts are row counts; dollar totals sum the award records above
            and are not deduplicated against modifications. Figures reflect what Iron
            Echelon has ingested, which is a subset of the federal record.{' '}
            <Link href="/compliance" className="text-accent-blue hover:underline">
              Browse the compliance data
            </Link>{' '}
            to check any of it.
          </p>
        </div>
      </div>
      <BottomBar />
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="border border-border rounded-lg bg-surface/40 p-3">
      <div className={`font-mono text-xl text-${tone}`}>{value}</div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted mt-1">{label}</div>
    </div>
  )
}

function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="border border-border rounded-lg bg-surface/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-xs tracking-[0.15em] text-foreground uppercase">{title}</h2>
        {hint && <span className="font-mono text-[10px] text-muted">{hint}</span>}
      </div>
      <div className="p-4 space-y-2">{children}</div>
    </section>
  )
}

function Row({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string | null
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
        <span className="font-mono text-[12px] text-foreground shrink-0">{value}</span>
      </div>
      {note && (
        <p className="font-mono text-[9px] text-muted mt-0.5 leading-relaxed max-w-2xl">{note}</p>
      )}
    </div>
  )
}
