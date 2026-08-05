'use client'

import type { VendorDossier as Dossier } from '@/lib/vendor/build-dossier'
import WatchButton from '@/components/WatchButton'
import CompliancePosture from '@/components/panels/CompliancePosture'
import AskAnalystButton from '@/components/AskAnalystButton'
import ExportButton from '@/components/ExportButton'

function fmt(value: number | null | undefined): string {
  const v = value || 0
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border border-border rounded-lg bg-surface/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-xs tracking-[0.15em] text-foreground uppercase">{title}</h2>
        {hint && <span className="text-[10px] text-muted font-mono">{hint}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Stat({ label, value, tone = 'foreground' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-[110px]">
      <div className={`font-mono text-lg text-${tone}`}>{value}</div>
      <div className="text-[10px] text-muted font-mono uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  )
}

const SET_ASIDE_LABELS: Record<string, string> = {
  SMALL_BUSINESS: 'Small Business', '8A': '8(a)', WOMAN_OWNED: 'Woman-Owned',
  VETERAN_OWNED: 'Veteran-Owned', SDVOSB: 'SDVOSB', HUBZONE: 'HUBZone',
  MINORITY_OWNED: 'Minority-Owned', DISADVANTAGED: 'Disadvantaged', NATIVE_AMERICAN: 'Native American',
}

export default function VendorDossier({ d }: { d: Dossier }) {
  const maxAgency = Math.max(1, ...d.pastPerformance.agencyBreakdown.map((a) => a.totalObligated))
  const foreign = d.identity.headquartersCountry && d.identity.headquartersCountry.alpha2 !== 'US'

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
      {/* Header */}
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-mono text-2xl md:text-3xl tracking-[0.08em] text-foreground uppercase">
              {d.identity.name}
            </h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px] font-mono">
              <span className="px-2 py-0.5 rounded border border-border text-muted-foreground uppercase">
                {d.identity.type.replace(/_/g, ' ')}
              </span>
              {d.identity.headquartersCity && (
                <span className={foreign ? 'text-accent-gold' : 'text-muted-foreground'}>
                  {d.identity.headquartersCity}
                  {d.identity.headquartersCountry ? ` · ${d.identity.headquartersCountry.name}` : ''}
                </span>
              )}
              {d.identity.businessSize && (
                <span className={`px-2 py-0.5 rounded ${d.identity.businessSize === 'SMALL' ? 'text-accent-green border border-accent-green/40' : 'text-muted border border-border'}`}>
                  {d.identity.businessSize === 'SMALL' ? 'SMALL BUSINESS' : 'OTHER THAN SMALL'}
                </span>
              )}
              {d.identity.setAsides.map((s) => (
                <span key={s} className="px-2 py-0.5 rounded bg-accent-green/10 text-accent-green">
                  {SET_ASIDE_LABELS[s] || s}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {d.identity.website && (
              <a href={d.identity.website} target="_blank" rel="noopener noreferrer"
                 className="text-xs font-mono text-accent-blue hover:underline">
                {d.identity.website.replace(/^https?:\/\//, '')} ↗
              </a>
            )}
            <ExportButton
              endpoint="/api/export/crosswalk"
              params={{ entity: d.identity.slug }}
              label="EXPORT DOSSIER"
            />
            <AskAnalystButton slug={d.identity.slug} name={d.identity.name} />
            <WatchButton
              targetType="ENTITY"
              targetId={d.identity.id}
              label={d.identity.name}
            />
          </div>
        </div>
        {d.identity.description && (
          <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">{d.identity.description}</p>
        )}
      </header>

      {/* Risk flags */}
      {d.riskFlags.length > 0 && (
        <div className="space-y-2">
          {d.riskFlags.map((r) => (
            <div key={r.flag} className="flex items-start gap-3 px-4 py-2.5 rounded-lg border border-accent-red/30 bg-accent-red/5">
              <span className="text-accent-red font-mono text-[10px] mt-0.5 shrink-0">⚠ RISK</span>
              <div>
                <div className="text-xs font-mono text-accent-red uppercase tracking-wider">{r.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Responsibility snapshot (FAR 9.104) */}
      <Section title="Responsibility Snapshot" hint="FAR 9.104 · Part 10 market research">
        <div className="flex flex-wrap gap-6">
          <Stat label="SAM Registration"
            value={d.responsibility.samRegistered
              ? <span className={d.responsibility.samStatus?.toLowerCase() === 'active' ? 'text-accent-green' : 'text-accent-red'}>{d.responsibility.samStatus || 'REGISTERED'}</span>
              : <span className="text-muted">NOT FOUND</span>} />
          <Stat label="UEI" value={<span className="text-sm">{d.identity.uei || '—'}</span>} />
          <Stat label="CAGE" value={<span className="text-sm">{d.identity.cageCode || '—'}</span>} />
          <Stat label="Active Authorizations" value={d.responsibility.activeAuthorizations} tone={d.responsibility.activeAuthorizations > 0 ? 'accent-green' : 'muted'} />
          <Stat label="Federal Obligated" value={fmt(d.pastPerformance.totalObligated)} tone="accent-blue" />
          <Stat label="SBIR/STTR Awards" value={d.sbir.totalAwards} tone={d.sbir.totalAwards > 0 ? 'accent-gold' : 'muted'} />
        </div>
        {d.responsibility.naics.length > 0 && (
          <div className="mt-4 text-[11px] font-mono text-muted-foreground">
            <span className="text-muted">NAICS:</span> {d.responsibility.naics.slice(0, 6).map((n) => n.code).join(', ')}
          </div>
        )}
      </Section>

      {/* Compliance posture — the ATO<->contract crosswalk. Replaces the flat
          authorization list this section used to render: same source data, plus
          the timeline, assessment countdowns, and agency leverage map. */}
      <CompliancePosture slug={d.identity.slug} />

      {/* Federal past performance by agency */}
      {(d.pastPerformance.agencyBreakdown.length > 0 || d.pastPerformance.topContracts.length > 0) && (
        <Section title="Federal Past Performance" hint="USAspending.gov · agencies supported">
          {d.pastPerformance.agencyBreakdown.length > 0 && (
            <div className="space-y-2 mb-4">
              {d.pastPerformance.agencyBreakdown.slice(0, 8).map((a) => (
                <div key={a.agency} className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-muted-foreground w-56 truncate shrink-0">{a.agency}</span>
                  <div className="flex-1 h-2 bg-surface rounded overflow-hidden">
                    <div className="h-full bg-accent-blue rounded" style={{ width: `${(a.totalObligated / maxAgency) * 100}%` }} />
                  </div>
                  <span className="text-[11px] font-mono text-accent-blue w-16 text-right shrink-0">{fmt(a.totalObligated)}</span>
                </div>
              ))}
            </div>
          )}
          {d.pastPerformance.topContracts.length > 0 && (
            <div className="space-y-1.5">
              {d.pastPerformance.topContracts.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 text-[11px]">
                  <div className="min-w-0">
                    {c.agency && <span className="font-mono text-accent-blue">{c.agency}</span>}
                    {c.description && <p className="text-muted-foreground line-clamp-1">{c.description}</p>}
                  </div>
                  {c.value != null && <span className="font-mono text-accent-green shrink-0">{fmt(c.value)}</span>}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* SBIR pedigree */}
      {d.sbir.totalAwards > 0 && (
        <Section title="SBIR / STTR Pedigree" hint="America's Seed Fund · R&D maturity">
          <div className="flex flex-wrap gap-6 mb-4">
            <Stat label="Total Awards" value={d.sbir.totalAwards} tone="accent-gold" />
            <Stat label="Total Value" value={fmt(d.sbir.totalValue)} tone="accent-gold" />
            {Object.entries(d.sbir.byPhase).map(([phase, s]) => (
              <Stat key={phase} label={`Phase ${phase}`} value={s.count} />
            ))}
          </div>
          <div className="space-y-1.5">
            {d.sbir.recent.slice(0, 5).map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-3 text-[11px]">
                <div className="min-w-0">
                  <span className="font-mono text-muted">{a.program} {a.phase ? `Ph ${a.phase}` : ''} {a.year || ''} · {a.agency}</span>
                  {a.title && <p className="text-muted-foreground line-clamp-1">{a.title}</p>}
                </div>
                {a.value != null && <span className="font-mono text-accent-gold shrink-0">{fmt(a.value)}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Funding */}
      {(d.funding.rounds.length > 0 || d.funding.fundedBy.length > 0) && (
        <Section title="Funding & Investors" hint="Government + private capital">
          <div className="flex flex-wrap gap-6 mb-3">
            {d.funding.governmentTotal > 0 && <Stat label="Government Funding" value={fmt(d.funding.governmentTotal)} tone="accent-blue" />}
            {d.funding.privateTotal > 0 && <Stat label="Private Capital" value={fmt(d.funding.privateTotal)} tone="accent-green" />}
          </div>
          {d.funding.fundedBy.length > 0 && (
            <div className="text-[11px] font-mono text-muted-foreground">
              <span className="text-muted">Backers:</span> {d.funding.fundedBy.map((f) => f.name).join(', ')}
            </div>
          )}
          {d.funding.rounds.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {d.funding.rounds.slice(0, 6).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 text-[11px] font-mono">
                  <span className="text-muted-foreground">{r.roundName || r.roundType || 'Round'}{r.source ? ` · ${r.source}` : ''}{r.date ? ` · ${r.date.slice(0, 10)}` : ''}</span>
                  {r.amount != null && <span className="text-accent-green shrink-0">{fmt(r.amount)}</span>}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Lobbying */}
      {d.lobbying.filingCount > 0 && (
        <Section title="Lobbying Disclosures" hint="Senate LDA">
          <div className="flex flex-wrap gap-6">
            <Stat label="Total Reported" value={fmt(d.lobbying.totalAmount)} tone="accent-gold" />
            <Stat label="Filings" value={d.lobbying.filingCount} />
          </div>
        </Section>
      )}

      {/* Methodology footer */}
      <footer className="text-[10px] text-muted font-mono leading-relaxed border-t border-border pt-4">
        Compiled from public sources: SAM.gov, USAspending.gov, FedRAMP Marketplace, DoD DCAS, SBIR.gov, and Senate LDA.
        {d.identity.vendorSyncedAt && ` Last enriched ${new Date(d.identity.vendorSyncedAt).toUTCString().replace(' GMT', ' UTC')}.`}
        {' '}This dossier supports market research (FAR Part 10) and responsibility determinations (FAR 9.104); it is decision support, not a formal determination of responsibility.
      </footer>
    </div>
  )
}
