'use client'

import React, { useEffect, useState, useMemo } from 'react'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import SearchCommand from '@/components/layout/SearchCommand'
import ExportButton from '@/components/ExportButton'
import { useAppStore } from '@/lib/store'

interface ContractRow {
  id: string
  awardId: string | null
  description: string | null
  value: number | null
  awardDate: string | null
  endDate: string | null
  naicsCode: string | null
  psc: string | null
  placeOfPerformance: string | null
  entity: { id: string; name: string; type: string }
  agency: { id: string; name: string } | null
}

interface ConnectionRow {
  id: string
  connectionType: string
  confidence: string
  value: number | null
  sourceEntity: { id: string; name: string; type: string }
  targetEntity: { id: string; name: string; type: string }
}

interface SbirRow {
  id: string
  description: string | null
  value: number | null
  awardDate: string | null
  sbirProgram: string | null
  sbirPhase: string | null
  sbirTopicCode: string | null
  sbirBranch: string | null
  sbirAwardYear: number | null
  sbirPiName: string | null
  entity: { id: string; name: string; type: string }
  agency: { id: string; name: string } | null
}

interface SbirStats {
  totalAwards: number
  totalValue: number
  sbirCount: number
  sttrCount: number
  byPhase: Record<string, { count: number; value: number }>
  byAgency: Array<{ name: string; count: number; value: number }>
  byYear: Array<{ year: number; count: number; value: number }>
  topWinners: Array<{ entityId: string; name: string; count: number; value: number }>
}

function formatCurrency(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

const PHASE_COLORS: Record<string, string> = {
  I: '#4A7C9B',
  II: '#B8953E',
  III: '#2ECC71',
}

type TabType = 'contracts' | 'investments' | 'sbir'

export default function ContractsPage() {
  const { setSearchOpen, selectEntity } = useAppStore()
  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [connections, setConnections] = useState<ConnectionRow[]>([])
  const [sbirContracts, setSbirContracts] = useState<SbirRow[]>([])
  const [sbirStats, setSbirStats] = useState<SbirStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<TabType>('contracts')
  const [sbirPhaseFilter, setSbirPhaseFilter] = useState('')
  const [sbirProgramFilter, setSbirProgramFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/contracts').then((r) => r.json()),
      fetch('/api/connections?type=INVESTED_IN').then((r) => r.json()),
      fetch('/api/sbir').then((r) => r.json()),
    ])
      .then(([contractData, connData, sbirData]) => {
        setContracts(contractData.contracts || [])
        setConnections(connData.connections || [])
        setSbirContracts(sbirData.contracts || [])
        setSbirStats(sbirData.stats || null)
        // Auto-switch to tab with data
        if ((!contractData.contracts || contractData.contracts.length === 0)) {
          if (sbirData.contracts?.length > 0) setTab('sbir')
          else if (connData.connections?.length > 0) setTab('investments')
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filteredContracts = useMemo(() => {
    if (!search) return contracts
    const q = search.toLowerCase()
    return contracts.filter(
      (c) =>
        c.entity.name.toLowerCase().includes(q) ||
        c.agency?.name.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
    )
  }, [contracts, search])

  const filteredConnections = useMemo(() => {
    if (!search) return connections
    const q = search.toLowerCase()
    return connections.filter(
      (c) =>
        c.sourceEntity.name.toLowerCase().includes(q) ||
        c.targetEntity.name.toLowerCase().includes(q)
    )
  }, [connections, search])

  const filteredSbir = useMemo(() => {
    let filtered = sbirContracts
    if (sbirPhaseFilter) filtered = filtered.filter((c) => c.sbirPhase === sbirPhaseFilter)
    if (sbirProgramFilter) filtered = filtered.filter((c) => c.sbirProgram === sbirProgramFilter)
    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(
        (c) =>
          c.entity.name.toLowerCase().includes(q) ||
          c.agency?.name.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q) ||
          c.sbirTopicCode?.toLowerCase().includes(q) ||
          c.sbirPiName?.toLowerCase().includes(q)
      )
    }
    return filtered
  }, [sbirContracts, search, sbirPhaseFilter, sbirProgramFilter])

  const totalContractValue = contracts.reduce((sum, c) => sum + (c.value || 0), 0)
  const uniqueAgencies = new Set(contracts.map((c) => c.agency?.name).filter(Boolean)).size
  const uniqueContractors = new Set(contracts.map((c) => c.entity.name)).size

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav onSearchOpen={() => setSearchOpen(true)} />
      <SearchCommand />

      <div className="flex-1 pt-12 pb-7 bg-background overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 md:p-6 border-b border-border shrink-0">
          <h1 className="font-mono text-lg md:text-2xl tracking-[0.15em] text-foreground mb-2">
            GOVERNMENT CONTRACTS & INVESTMENTS
          </h1>
          <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
            <p className="text-sm text-slate-400">
              Federal contract awards, SBIR/STTR research grants, and investment relationships.
            </p>
            <ExportButton endpoint="/api/export/contracts" />
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-2 md:gap-4 mb-4 overflow-x-auto">
            <button
              onClick={() => setTab('contracts')}
              className={`font-mono text-[12px] md:text-xs tracking-wider px-2 md:px-3 py-1.5 rounded transition-colors shrink-0 ${
                tab === 'contracts'
                  ? 'text-accent-red bg-accent-red/10 border border-accent-red/30'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              GOV CONTRACTS ({contracts.length})
            </button>
            <button
              onClick={() => setTab('sbir')}
              className={`font-mono text-[12px] md:text-xs tracking-wider px-2 md:px-3 py-1.5 rounded transition-colors shrink-0 ${
                tab === 'sbir'
                  ? 'text-accent-gold bg-accent-gold/10 border border-accent-gold/30'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              SBIR / STTR ({sbirStats?.totalAwards || 0})
            </button>
            <button
              onClick={() => setTab('investments')}
              className={`font-mono text-[12px] md:text-xs tracking-wider px-2 md:px-3 py-1.5 rounded transition-colors shrink-0 ${
                tab === 'investments'
                  ? 'text-accent-green bg-accent-green/10 border border-accent-green/30'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              INVESTMENTS ({connections.length})
            </button>
          </div>

          {/* Stats per tab */}
          {tab === 'contracts' ? (
            <div className="flex flex-wrap gap-4 md:gap-6 mb-4">
              <div>
                <span className="font-mono text-lg text-accent-red">{contracts.length}</span>
                <span className="text-xs text-muted font-mono ml-2">CONTRACTS</span>
              </div>
              {totalContractValue > 0 && (
                <div>
                  <span className="font-mono text-lg text-accent-green">{formatCurrency(totalContractValue)}</span>
                  <span className="text-xs text-muted font-mono ml-2">TOTAL VALUE</span>
                </div>
              )}
              <div>
                <span className="font-mono text-lg text-accent-blue">{uniqueAgencies}</span>
                <span className="text-xs text-muted font-mono ml-2">AGENCIES</span>
              </div>
              <div>
                <span className="font-mono text-lg text-accent-gold">{uniqueContractors}</span>
                <span className="text-xs text-muted font-mono ml-2">CONTRACTORS</span>
              </div>
            </div>
          ) : tab === 'sbir' && sbirStats ? (
            <div className="space-y-4 mb-4">
              {/* SBIR summary stats */}
              <div className="flex flex-wrap gap-4 md:gap-6">
                <div>
                  <span className="font-mono text-lg text-accent-gold">{sbirStats.totalAwards}</span>
                  <span className="text-xs text-muted font-mono ml-2">AWARDS</span>
                </div>
                {sbirStats.totalValue > 0 && (
                  <div>
                    <span className="font-mono text-lg text-accent-green">{formatCurrency(sbirStats.totalValue)}</span>
                    <span className="text-xs text-muted font-mono ml-2">TOTAL VALUE</span>
                  </div>
                )}
                <div>
                  <span className="font-mono text-lg text-accent-blue">{sbirStats.sbirCount}</span>
                  <span className="text-xs text-muted font-mono ml-2">SBIR</span>
                </div>
                <div>
                  <span className="font-mono text-lg text-[#8B5CF6]">{sbirStats.sttrCount}</span>
                  <span className="text-xs text-muted font-mono ml-2">STTR</span>
                </div>
              </div>

              {/* Phase cards */}
              <div className="flex flex-wrap gap-2 md:gap-3">
                {['I', 'II', 'III'].map((phase) => {
                  const data = sbirStats.byPhase[phase]
                  if (!data) return null
                  return (
                    <button
                      key={phase}
                      onClick={() => setSbirPhaseFilter(sbirPhaseFilter === phase ? '' : phase)}
                      className={`flex items-center gap-2 md:gap-3 px-3 py-2 rounded border transition-colors ${
                        sbirPhaseFilter === phase
                          ? 'border-accent-gold/50 bg-accent-gold/10'
                          : 'border-border bg-surface hover:border-border-bright'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: PHASE_COLORS[phase] }}
                      />
                      <span className="font-mono text-[12px] md:text-xs text-foreground tracking-wider">PHASE {phase}</span>
                      <span className="font-mono text-[12px] md:text-xs text-muted">{data.count}</span>
                      {data.value > 0 && (
                        <span className="font-mono text-[12px] text-accent-green">{formatCurrency(data.value)}</span>
                      )}
                    </button>
                  )
                })}
                {/* Program filter */}
                <button
                  onClick={() => setSbirProgramFilter(sbirProgramFilter === 'SBIR' ? '' : 'SBIR')}
                  className={`px-3 py-2 rounded border font-mono text-[12px] md:text-xs tracking-wider transition-colors ${
                    sbirProgramFilter === 'SBIR'
                      ? 'border-accent-blue/50 bg-accent-blue/10 text-accent-blue'
                      : 'border-border bg-surface text-muted hover:border-border-bright'
                  }`}
                >
                  SBIR ONLY
                </button>
                <button
                  onClick={() => setSbirProgramFilter(sbirProgramFilter === 'STTR' ? '' : 'STTR')}
                  className={`px-3 py-2 rounded border font-mono text-[12px] md:text-xs tracking-wider transition-colors ${
                    sbirProgramFilter === 'STTR'
                      ? 'border-[#8B5CF6]/50 bg-[#8B5CF6]/10 text-[#8B5CF6]'
                      : 'border-border bg-surface text-muted hover:border-border-bright'
                  }`}
                >
                  STTR ONLY
                </button>
              </div>
            </div>
          ) : tab === 'investments' ? (
            <div className="flex flex-wrap gap-4 md:gap-6 mb-4">
              <div>
                <span className="font-mono text-lg text-accent-green">{connections.length}</span>
                <span className="text-xs text-muted font-mono ml-2">CONNECTIONS</span>
              </div>
              <div>
                <span className="font-mono text-lg text-accent-blue">{new Set(connections.map((c) => c.sourceEntity.id)).size}</span>
                <span className="text-xs text-muted font-mono ml-2">INVESTORS</span>
              </div>
              <div>
                <span className="font-mono text-lg text-accent-gold">{new Set(connections.map((c) => c.targetEntity.id)).size}</span>
                <span className="text-xs text-muted font-mono ml-2">ENTITIES</span>
              </div>
            </div>
          ) : null}

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              tab === 'contracts' ? 'Search contracts, agencies, companies...'
              : tab === 'sbir' ? 'Search SBIR awards, topics, PIs...'
              : 'Search connections...'
            }
            className="w-full max-w-md px-3 py-2 bg-surface border border-border rounded text-sm font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50"
          />

          {/* Data source */}
          <div className="mt-3 text-[11px] font-mono text-muted tracking-wider">
            {tab === 'contracts' ? (
              <>DATA SOURCE: <span className="text-accent-blue">USASPENDING.GOV</span> — Federal Award Data</>
            ) : tab === 'sbir' ? (
              <>DATA SOURCE: <span className="text-accent-gold">SBIR.GOV</span> / <span className="text-accent-blue">USASPENDING.GOV</span> — Small Business Innovation Research</>
            ) : (
              <>DATA SOURCE: <span className="text-accent-green">SURVEILLANCE WATCH</span> — Investment Relationships</>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-10 bg-surface rounded animate-pulse" />
              ))}
            </div>
          ) : tab === 'contracts' ? (
            contracts.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md">
                  <div className="font-mono text-accent-red text-lg tracking-[0.2em] mb-4">SYNCING CONTRACTS</div>
                  <p className="text-sm text-slate-400 mb-4">
                    Government contract data is being fetched from USAspending.gov.
                    Run the contract seeder to populate this view:
                  </p>
                  <code className="text-xs font-mono text-accent-blue bg-surface px-3 py-2 rounded block">
                    npx tsx prisma/seed-contracts.ts
                  </code>
                </div>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-background border-b border-border z-10">
                  <tr>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Contractor</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Agency</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden md:table-cell">Description</th>
                    <th className="text-right px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Value</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContracts.map((contract) => {
                    const isExpanded = expandedId === contract.id
                    return (
                    <React.Fragment key={contract.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : contract.id)}
                      className={`border-b border-border/30 hover:bg-surface/50 transition-colors cursor-pointer ${isExpanded ? 'bg-surface/50' : ''}`}
                    >
                      <td className="px-3 md:px-6 py-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); selectEntity(contract.entity.id) }}
                          className="text-xs font-mono text-slate-300 hover:text-white transition-colors text-left"
                        >
                          {contract.entity.name}
                        </button>
                      </td>
                      <td className="px-3 md:px-6 py-2">
                        <span className="text-xs font-mono text-accent-blue">
                          {contract.agency?.name || 'N/A'}
                        </span>
                      </td>
                      <td className="px-3 md:px-6 py-2 max-w-sm hidden md:table-cell">
                        <span className="text-[13px] text-muted-foreground line-clamp-2">
                          {contract.description || '—'}
                        </span>
                      </td>
                      <td className="px-3 md:px-6 py-2 text-right">
                        {contract.value ? (
                          <span className="text-xs font-mono text-accent-green font-bold">
                            {formatCurrency(contract.value)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                        <span className="text-[12px] font-mono text-muted">
                          {contract.awardDate ? formatDate(contract.awardDate) : '—'}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-surface/30 border-b border-border/30">
                        <td colSpan={5} className="px-4 md:px-8 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-3">
                              <div>
                                <span className="text-[11px] font-mono text-muted tracking-wider">AWARD ID</span>
                                <p className="text-xs font-mono text-foreground mt-0.5">{contract.awardId || '—'}</p>
                              </div>
                              <div>
                                <span className="text-[11px] font-mono text-muted tracking-wider">DESCRIPTION</span>
                                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{contract.description || '—'}</p>
                              </div>
                              {contract.naicsCode && (
                                <div>
                                  <span className="text-[11px] font-mono text-muted tracking-wider">NAICS CODE</span>
                                  <p className="text-xs font-mono text-foreground mt-0.5">{contract.naicsCode}</p>
                                </div>
                              )}
                              {contract.psc && (
                                <div>
                                  <span className="text-[11px] font-mono text-muted tracking-wider">PSC</span>
                                  <p className="text-xs font-mono text-foreground mt-0.5">{contract.psc}</p>
                                </div>
                              )}
                            </div>
                            <div className="space-y-3">
                              <div>
                                <span className="text-[11px] font-mono text-muted tracking-wider">CONTRACTOR</span>
                                <p className="text-xs font-mono text-foreground mt-0.5">{contract.entity.name}</p>
                                <span className="text-[11px] font-mono text-accent-blue">{contract.entity.type.replace(/_/g, ' ')}</span>
                              </div>
                              <div>
                                <span className="text-[11px] font-mono text-muted tracking-wider">AWARDING AGENCY</span>
                                <p className="text-xs font-mono text-accent-blue mt-0.5">{contract.agency?.name || 'N/A'}</p>
                              </div>
                              <div className="flex gap-6">
                                <div>
                                  <span className="text-[11px] font-mono text-muted tracking-wider">AWARD DATE</span>
                                  <p className="text-xs font-mono text-foreground mt-0.5">{contract.awardDate ? formatDate(contract.awardDate) : '—'}</p>
                                </div>
                                {contract.endDate && (
                                  <div>
                                    <span className="text-[11px] font-mono text-muted tracking-wider">END DATE</span>
                                    <p className="text-xs font-mono text-foreground mt-0.5">{formatDate(contract.endDate)}</p>
                                  </div>
                                )}
                                <div>
                                  <span className="text-[11px] font-mono text-muted tracking-wider">VALUE</span>
                                  <p className="text-xs font-mono text-accent-green font-bold mt-0.5">{contract.value ? formatCurrency(contract.value) : '—'}</p>
                                </div>
                              </div>
                              {contract.placeOfPerformance && (
                                <div>
                                  <span className="text-[11px] font-mono text-muted tracking-wider">PLACE OF PERFORMANCE</span>
                                  <p className="text-xs font-mono text-foreground mt-0.5">{contract.placeOfPerformance}</p>
                                </div>
                              )}
                              {contract.awardId && (
                                <a
                                  href={`https://www.usaspending.gov/award/${contract.awardId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-block mt-2 text-[12px] font-mono text-accent-blue border border-accent-blue/30 px-3 py-1.5 rounded hover:bg-accent-blue/10 transition-colors tracking-wider"
                                >
                                  VIEW ON USASPENDING.GOV
                                </a>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            )
          ) : tab === 'sbir' ? (
            sbirContracts.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md">
                  <div className="font-mono text-accent-gold text-lg tracking-[0.2em] mb-4">SYNCING SBIR DATA</div>
                  <p className="text-sm text-slate-400 mb-4">
                    SBIR/STTR award data needs to be fetched. Run the SBIR seeder:
                  </p>
                  <code className="text-xs font-mono text-accent-blue bg-surface px-3 py-2 rounded block">
                    npx tsx prisma/seed-sbir.ts
                  </code>
                  <p className="text-xs text-muted mt-4">
                    Fetches from SBIR.gov and USAspending for tracked defense companies.
                  </p>
                </div>
              </div>
            ) : (
              <div>
                {/* SBIR analytics panels */}
                {sbirStats && !search && !sbirPhaseFilter && !sbirProgramFilter && (
                  <div className="p-4 md:p-6 border-b border-border space-y-6">
                    {/* Top winners + agency breakdown side by side */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Top winners */}
                      <div>
                        <h3 className="font-mono text-[12px] tracking-[0.2em] text-muted mb-3 uppercase">Top SBIR/STTR Winners</h3>
                        <div className="space-y-1.5">
                          {sbirStats.topWinners.slice(0, 8).map((w, i) => (
                            <button
                              key={w.entityId}
                              onClick={() => selectEntity(w.entityId)}
                              className="w-full flex items-center gap-2 text-left hover:bg-surface/50 rounded px-2 py-1 transition-colors group"
                            >
                              <span className="font-mono text-[12px] text-muted w-4">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground truncate">
                                    {w.name}
                                  </span>
                                  <div className="flex items-center gap-2 shrink-0 ml-2">
                                    <span className="text-[12px] font-mono text-accent-gold">{w.count} awards</span>
                                    {w.value > 0 && (
                                      <span className="text-[12px] font-mono text-accent-green">{formatCurrency(w.value)}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="w-full h-0.5 bg-surface-hover rounded mt-1">
                                  <div
                                    className="h-full bg-accent-gold/50 rounded"
                                    style={{ width: `${(w.count / sbirStats.topWinners[0].count) * 100}%` }}
                                  />
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Agency breakdown */}
                      <div>
                        <h3 className="font-mono text-[12px] tracking-[0.2em] text-muted mb-3 uppercase">Awarding Agencies</h3>
                        <div className="space-y-1.5">
                          {sbirStats.byAgency.slice(0, 8).map((a) => (
                            <div key={a.name} className="flex items-center gap-2 px-2 py-1">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-mono text-muted-foreground truncate">
                                    {a.name}
                                  </span>
                                  <div className="flex items-center gap-2 shrink-0 ml-2">
                                    <span className="text-[12px] font-mono text-accent-blue">{a.count}</span>
                                    {a.value > 0 && (
                                      <span className="text-[12px] font-mono text-accent-green">{formatCurrency(a.value)}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="w-full h-0.5 bg-surface-hover rounded mt-1">
                                  <div
                                    className="h-full bg-accent-blue/50 rounded"
                                    style={{ width: `${(a.count / sbirStats.byAgency[0].count) * 100}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Year timeline */}
                    {sbirStats.byYear.length > 1 && (
                      <div>
                        <h3 className="font-mono text-[12px] tracking-[0.2em] text-muted mb-3 uppercase">Awards by Year</h3>
                        <div className="flex items-end gap-1 h-20">
                          {sbirStats.byYear.map((y) => {
                            const maxCount = Math.max(...sbirStats.byYear.map((yy) => yy.count))
                            const heightPct = (y.count / maxCount) * 100
                            return (
                              <div key={y.year} className="flex-1 flex flex-col items-center gap-1 group">
                                <span className="text-[8px] font-mono text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                                  {y.count}
                                </span>
                                <div
                                  className="w-full bg-accent-gold/40 hover:bg-accent-gold/70 rounded-t transition-colors"
                                  style={{ height: `${Math.max(heightPct, 4)}%` }}
                                  title={`${y.year}: ${y.count} awards, ${formatCurrency(y.value)}`}
                                />
                                <span className="text-[7px] font-mono text-muted">{String(y.year).slice(2)}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Awards table */}
                <table className="w-full">
                  <thead className="sticky top-0 bg-background border-b border-border z-10">
                    <tr>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Company</th>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Phase</th>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Agency</th>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden md:table-cell">Description</th>
                      <th className="text-right px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Value</th>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Year</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSbir.slice(0, 500).map((award) => {
                      const isExpanded = expandedId === award.id
                      return (
                      <React.Fragment key={award.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : award.id)}
                        className={`border-b border-border/30 hover:bg-surface/50 transition-colors cursor-pointer ${isExpanded ? 'bg-surface/50' : ''}`}
                      >
                        <td className="px-3 md:px-6 py-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); selectEntity(award.entity.id) }}
                            className="text-xs font-mono text-slate-300 hover:text-white transition-colors text-left"
                          >
                            {award.entity.name}
                          </button>
                        </td>
                        <td className="px-3 md:px-6 py-2">
                          <div className="flex items-center gap-1.5">
                            {award.sbirPhase && (
                              <span
                                className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded"
                                style={{
                                  color: PHASE_COLORS[award.sbirPhase] || '#64748B',
                                  backgroundColor: (PHASE_COLORS[award.sbirPhase] || '#64748B') + '20',
                                }}
                              >
                                {award.sbirPhase}
                              </span>
                            )}
                            <span className="text-[11px] font-mono text-muted">
                              {award.sbirProgram}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                          <span className="text-[12px] font-mono text-accent-blue truncate block max-w-[150px]">
                            {award.sbirBranch || award.agency?.name || '—'}
                          </span>
                        </td>
                        <td className="px-3 md:px-6 py-2 max-w-sm hidden md:table-cell">
                          <span className="text-[13px] text-muted-foreground line-clamp-2">
                            {award.description || '—'}
                          </span>
                        </td>
                        <td className="px-3 md:px-6 py-2 text-right">
                          {award.value ? (
                            <span className="text-xs font-mono text-accent-green font-bold">
                              {formatCurrency(award.value)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                          <span className="text-[12px] font-mono text-muted">
                            {award.sbirAwardYear || (award.awardDate ? new Date(award.awardDate).getFullYear() : '—')}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-surface/30 border-b border-border/30">
                          <td colSpan={6} className="px-4 md:px-8 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-3">
                                <div>
                                  <span className="text-[11px] font-mono text-muted tracking-wider">DESCRIPTION</span>
                                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{award.description || '—'}</p>
                                </div>
                                {award.sbirTopicCode && (
                                  <div>
                                    <span className="text-[11px] font-mono text-muted tracking-wider">TOPIC CODE</span>
                                    <p className="text-xs font-mono text-foreground mt-0.5">{award.sbirTopicCode}</p>
                                  </div>
                                )}
                                {award.sbirPiName && (
                                  <div>
                                    <span className="text-[11px] font-mono text-muted tracking-wider">PRINCIPAL INVESTIGATOR</span>
                                    <p className="text-xs font-mono text-foreground mt-0.5">{award.sbirPiName}</p>
                                  </div>
                                )}
                              </div>
                              <div className="space-y-3">
                                <div>
                                  <span className="text-[11px] font-mono text-muted tracking-wider">COMPANY</span>
                                  <p className="text-xs font-mono text-foreground mt-0.5">{award.entity.name}</p>
                                  <span className="text-[11px] font-mono text-accent-blue">{award.entity.type.replace(/_/g, ' ')}</span>
                                </div>
                                <div className="flex gap-6">
                                  <div>
                                    <span className="text-[11px] font-mono text-muted tracking-wider">PROGRAM</span>
                                    <p className="text-xs font-mono text-foreground mt-0.5">{award.sbirProgram || '—'} {award.sbirPhase ? `Phase ${award.sbirPhase}` : ''}</p>
                                  </div>
                                  <div>
                                    <span className="text-[11px] font-mono text-muted tracking-wider">AGENCY</span>
                                    <p className="text-xs font-mono text-accent-blue mt-0.5">{award.sbirBranch || award.agency?.name || '—'}</p>
                                  </div>
                                </div>
                                <div className="flex gap-6">
                                  <div>
                                    <span className="text-[11px] font-mono text-muted tracking-wider">AWARD DATE</span>
                                    <p className="text-xs font-mono text-foreground mt-0.5">{award.awardDate ? formatDate(award.awardDate) : '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-[11px] font-mono text-muted tracking-wider">VALUE</span>
                                    <p className="text-xs font-mono text-accent-green font-bold mt-0.5">{award.value ? formatCurrency(award.value) : '—'}</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            /* Investments table */
            <table className="w-full">
              <thead className="sticky top-0 bg-background border-b border-border z-10">
                <tr>
                  <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Investor</th>
                  <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Entity</th>
                  <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Type</th>
                  <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {filteredConnections.slice(0, 500).map((conn) => (
                  <tr
                    key={conn.id}
                    className="border-b border-border/30 hover:bg-surface/50 transition-colors"
                  >
                    <td className="px-3 md:px-6 py-2">
                      <button
                        onClick={() => selectEntity(conn.sourceEntity.id)}
                        className="text-xs font-mono text-slate-300 hover:text-white transition-colors text-left"
                      >
                        {conn.sourceEntity.name}
                      </button>
                    </td>
                    <td className="px-3 md:px-6 py-2">
                      <button
                        onClick={() => selectEntity(conn.targetEntity.id)}
                        className="text-xs font-mono text-slate-300 hover:text-white transition-colors text-left"
                      >
                        {conn.targetEntity.name}
                      </button>
                    </td>
                    <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                      <span className="text-[12px] font-mono text-accent-blue">
                        {conn.connectionType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-3 md:px-6 py-2">
                      <span className={`text-[12px] font-mono px-1.5 py-0.5 rounded ${
                        conn.confidence === 'confirmed'
                          ? 'text-accent-green bg-accent-green/10'
                          : 'text-accent-gold bg-accent-gold/10'
                      }`}>
                        {conn.confidence?.toUpperCase() || 'N/A'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <BottomBar />
    </div>
  )
}
