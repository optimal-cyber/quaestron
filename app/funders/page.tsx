'use client'

import { useEffect, useState } from 'react'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import SearchCommand from '@/components/layout/SearchCommand'
import EntityDetail from '@/components/panels/EntityDetail'
import { useAppStore } from '@/lib/store'
import { ENTITY_TYPE_COLORS, ENTITY_TYPE_LABELS, type EntityType } from '@/lib/types'

interface Funder {
  id: string
  name: string
  slug: string
  type: string
  headquartersCountry?: { name: string; alpha2: string } | null
  connectionCount: number
}

interface TechStat {
  name: string
  count: number
}

interface TypeBreakdown {
  type: string
  count: number
}

interface FundedVendor {
  name: string
  slug: string
  government: number
  private: number
  total: number
}

interface FunderStats {
  technologiesFunded: TechStat[]
  typeBreakdown: TypeBreakdown[]
  totalConnections: number
  funding?: {
    governmentTotal: number
    privateTotal: number
    totalFunding: number
    fundedVendorCount: number
    topFunded: FundedVendor[]
  }
}

function fmtUSD(v: number): string {
  if (!v) return '$0'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

interface EntityDetailData {
  id: string
  name: string
  slug: string
  type: string
  subTypes: string[]
  description: string
  headquartersCity: string | null
  headquartersCountry: { name: string; alpha2: string } | null
  founded: number | null
  website: string | null
  alsoKnownAs: string[]
  fundingType: string | null
  ticker: string | null
  stockExchange: string | null
  isin: string | null
  hasDirectTargets: boolean
  providingTo: Array<{ name: string; slug: string; lat: number; lon: number }>
  surveilling: Array<{ name: string; slug: string; lat: number; lon: number }>
  sources: { url: string; title: string; domain: string; date?: string }[]
  connectionsFrom: Array<{
    id: string
    connectionType: string
    confidence: string
    value: number | null
    targetEntity: {
      id: string
      name: string
      slug: string
      type: string
      headquartersCountry?: { name: string; alpha2: string; latitude: number; longitude: number } | null
    }
  }>
  connectionsTo: Array<{
    id: string
    connectionType: string
    confidence: string
    value: number | null
    sourceEntity: {
      id: string
      name: string
      slug: string
      type: string
      headquartersCountry?: { name: string; alpha2: string; latitude: number; longitude: number } | null
    }
  }>
  contracts: Array<{
    id: string
    description: string | null
    value: number | null
    awardDate: string | null
    agency: { name: string } | null
  }>
  connectionCount: number
  updatedAt: string
}

export default function FundersPage() {
  const { setSearchOpen, selectEntity, selectedEntityId } = useAppStore()
  const [funders, setFunders] = useState<Funder[]>([])
  const [stats, setStats] = useState<FunderStats | null>(null)
  const [selectedEntity, setSelectedEntity] = useState<EntityDetailData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/entities?types=INVESTOR&sort=connections&direction=desc').then((r) => r.json()),
      fetch('/api/funders-stats').then((r) => r.json()),
    ])
      .then(([data, statsData]) => {
        setFunders(data.entities || [])
        setStats(statsData)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Fetch selected entity detail
  useEffect(() => {
    if (!selectedEntityId) {
      setSelectedEntity(null)
      return
    }
    fetch(`/api/entities/${selectedEntityId}`)
      .then((res) => res.json())
      .then(setSelectedEntity)
      .catch(console.error)
  }, [selectedEntityId])

  const maxTechCount = stats?.technologiesFunded[0]?.count || 1

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav onSearchOpen={() => setSearchOpen(true)} />
      <SearchCommand />

      <div className="flex-1 pt-12 pb-7 flex flex-col md:flex-row bg-background min-h-0">
        {/* Desktop sidebar list */}
        <div className="hidden md:block w-72 shrink-0 border-r border-border overflow-y-auto bg-surface/50 p-4">
          <h2 className="font-mono text-xs tracking-[0.2em] text-accent-gold mb-4">
            SURVEILLANCE FUNDERS
          </h2>
          <p className="text-xs text-muted mb-4">{funders.length} investors tracked</p>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-surface-hover rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {funders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => selectEntity(f.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm font-mono tracking-wide transition-colors ${
                    selectedEntityId === f.id
                      ? 'bg-accent-green/10 border-l-2 border-accent-green text-foreground'
                      : 'hover:bg-surface-hover text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{f.name}</span>
                    <span className="text-xs text-muted ml-2">{f.connectionCount}</span>
                  </div>
                  {f.headquartersCountry && (
                    <div className="text-[12px] text-muted mt-0.5">
                      {f.headquartersCountry.name}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mobile: horizontal scrolling funder chips */}
        <div className="md:hidden border-b border-border px-3 py-2 overflow-x-auto shrink-0">
          <div className="flex gap-2">
            {funders.slice(0, 20).map((f) => (
              <button
                key={f.id}
                onClick={() => selectEntity(f.id)}
                className={`shrink-0 px-3 py-1.5 rounded text-[12px] font-mono tracking-wider transition-colors ${
                  selectedEntityId === f.id
                    ? 'bg-accent-gold/15 border border-accent-gold/40 text-accent-gold'
                    : 'bg-surface border border-border text-muted-foreground'
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-4xl">
            <h1 className="font-mono text-2xl tracking-[0.15em] text-foreground mb-2">
              DEFENSE & SURVEILLANCE FUNDERS
            </h1>
            <p className="text-sm text-muted-foreground mb-8">
              Investors, private equity firms, and venture capital funds backing defense technology and surveillance companies.
            </p>

            {!loading && stats && (
              <>
                {/* Summary stats */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-8">
                  <div className="bg-surface border border-border rounded-lg p-4">
                    <div className="font-mono text-2xl text-accent-green mb-1">{funders.length}</div>
                    <div className="text-xs text-muted font-mono tracking-wider">TOTAL FUNDERS</div>
                  </div>
                  <div className="bg-surface border border-border rounded-lg p-4">
                    <div className="font-mono text-2xl text-accent-blue mb-1">{stats.totalConnections}</div>
                    <div className="text-xs text-muted font-mono tracking-wider">TOTAL INVESTMENTS</div>
                  </div>
                  <div className="bg-surface border border-border rounded-lg p-4">
                    <div className="font-mono text-2xl text-accent-gold mb-1">
                      {stats.typeBreakdown.reduce((sum, t) => t.type !== 'INVESTOR' ? sum + t.count : sum, 0)}
                    </div>
                    <div className="text-xs text-muted font-mono tracking-wider">ENTITIES FUNDED</div>
                  </div>
                </div>

                {/* Capital deployed (real funding amounts) */}
                {stats.funding && stats.funding.totalFunding > 0 && (
                  <div className="mb-8">
                    <h3 className="font-mono text-xs tracking-[0.2em] text-muted mb-4 uppercase">Capital Deployed</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5">
                      <div className="bg-surface border border-border rounded-lg p-4">
                        <div className="font-mono text-2xl text-accent-blue mb-1">{fmtUSD(stats.funding.governmentTotal)}</div>
                        <div className="text-xs text-muted font-mono tracking-wider">GOVERNMENT FUNDING</div>
                      </div>
                      <div className="bg-surface border border-border rounded-lg p-4">
                        <div className="font-mono text-2xl text-accent-green mb-1">{fmtUSD(stats.funding.privateTotal)}</div>
                        <div className="text-xs text-muted font-mono tracking-wider">PRIVATE CAPITAL</div>
                      </div>
                      <div className="bg-surface border border-border rounded-lg p-4">
                        <div className="font-mono text-2xl text-foreground mb-1">{fmtUSD(stats.funding.totalFunding)}</div>
                        <div className="text-xs text-muted font-mono tracking-wider">TOTAL TRACKED</div>
                      </div>
                      <div className="bg-surface border border-border rounded-lg p-4">
                        <div className="font-mono text-2xl text-accent-gold mb-1">{stats.funding.fundedVendorCount}</div>
                        <div className="text-xs text-muted font-mono tracking-wider">VENDORS FUNDED</div>
                      </div>
                    </div>

                    {stats.funding.topFunded.length > 0 && (
                      <div>
                        <h4 className="font-mono text-[12px] tracking-[0.2em] text-muted mb-2 uppercase">Most-Funded Vendors</h4>
                        <div className="space-y-1.5">
                          {stats.funding.topFunded.map((v) => (
                            <a
                              key={v.slug}
                              href={`/vendor/${v.slug}`}
                              className="flex items-center gap-3 group"
                            >
                              <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground w-48 truncate shrink-0 transition-colors">
                                {v.name}
                              </span>
                              <div className="flex-1 h-2 bg-surface rounded overflow-hidden flex">
                                {v.government > 0 && (
                                  <div className="h-full bg-accent-blue" style={{ width: `${(v.government / stats.funding!.topFunded[0].total) * 100}%` }} />
                                )}
                                {v.private > 0 && (
                                  <div className="h-full bg-accent-green" style={{ width: `${(v.private / stats.funding!.topFunded[0].total) * 100}%` }} />
                                )}
                              </div>
                              <span className="text-xs font-mono text-foreground w-16 text-right shrink-0">{fmtUSD(v.total)}</span>
                            </a>
                          ))}
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-[12px] font-mono text-muted">
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-blue" /> Government</span>
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-green" /> Private</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Type breakdown */}
                <div className="mb-8">
                  <h3 className="font-mono text-xs tracking-[0.2em] text-muted mb-4 uppercase">Sector Breakdown</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {stats.typeBreakdown.map((tb) => (
                      <div key={tb.type} className="flex items-center justify-between bg-surface border border-border rounded px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: ENTITY_TYPE_COLORS[tb.type as EntityType] || '#64748B' }}
                          />
                          <span className="text-xs font-mono text-muted-foreground">
                            {ENTITY_TYPE_LABELS[tb.type as EntityType] || tb.type}
                          </span>
                        </div>
                        <span className="text-xs font-mono text-foreground font-bold">{tb.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Technologies Funded */}
                <div>
                  <h3 className="font-mono text-xs tracking-[0.2em] text-muted mb-4 uppercase">Technologies Funded</h3>
                  <div className="space-y-2">
                    {stats.technologiesFunded.map((tech) => (
                      <div key={tech.name} className="group">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                            {tech.name}
                          </span>
                          <span className="text-xs font-mono text-accent-gold">{tech.count}</span>
                        </div>
                        <div className="w-full h-1 bg-surface-hover rounded overflow-hidden">
                          <div
                            className="h-full bg-accent-gold/60 rounded transition-all"
                            style={{ width: `${(tech.count / maxTechCount) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right sidebar - entity detail (desktop) */}
        {selectedEntity && (
          <div className="hidden md:block w-96 shrink-0 border-l border-border overflow-y-auto bg-surface/50">
            <EntityDetail
              entity={selectedEntity}
              onClose={() => selectEntity(null)}
            />
          </div>
        )}

        {/* Mobile entity detail overlay */}
        {selectedEntity && (
          <div className="md:hidden fixed inset-0 z-40 pt-12 bg-background overflow-y-auto">
            <div className="sticky top-0 z-10 bg-surface/90 backdrop-blur-md border-b border-border px-3 py-2 flex items-center justify-between">
              <span className="font-mono text-xs text-accent-gold tracking-wider">FUNDER DETAIL</span>
              <button
                onClick={() => selectEntity(null)}
                className="font-mono text-xs text-muted hover:text-foreground px-2 py-1"
              >
                CLOSE
              </button>
            </div>
            <EntityDetail
              entity={selectedEntity}
              onClose={() => selectEntity(null)}
            />
          </div>
        )}
      </div>

      <BottomBar />
    </div>
  )
}
