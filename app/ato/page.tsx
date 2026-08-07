'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import SearchCommand from '@/components/layout/SearchCommand'
import { useAppStore } from '@/lib/store'

// --- Types ---

interface AtoStats {
  fedramp: { total: number; byStatus: Record<string, number>; expiringWithin90Days: number }
  dodPa: { total: number }
  emass: { total: number }
  federalContracts: { totalRelevant: number }
}

interface FedRAMPRow {
  id: string
  cspName: string
  csoName: string
  status: string
  impactLevel: string | null
  serviceModel: string
  deploymentModel: string | null
  sponsoringAgency: string | null
  assessorName: string | null
  authType: string | null
  authorizationDate: string | null
  expirationDate: string | null
  serviceDescription: string | null
  website: string | null
  logo: string | null
}

interface DoDPARow {
  id: string
  csoName: string
  cspName: string
  impactLevel: string
  paDate: string | null
  paExpiration: string | null
  sponsorComponent: string | null
  conditions: string | null
  source: string
}

interface EMassRow {
  id: string
  systemName: string
  systemId: string | null
  component: string
  authorizationType: string
  authorizationDate: string | null
  expirationDate: string | null
  impactLevel: string | null
}

interface ContractIntelRow {
  id: string
  recipientName: string
  awardingAgency: string | null
  awardingSubAgency: string | null
  awardAmount: number | null
  description: string | null
  atoRelevanceScore: number
  startDate: string | null
}

interface ExpiringRow {
  source: string
  name: string
  type: string
  expirationDate: string
  daysRemaining: number
  impactLevel: string | null
}

// --- Helpers ---

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

function formatCurrency(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function isExpiringSoon(dateStr: string | null): boolean {
  if (!dateStr) return false
  const diff = new Date(dateStr).getTime() - Date.now()
  return diff > 0 && diff < 90 * 24 * 60 * 60 * 1000
}

function statusColor(status: string): string {
  const s = status.toLowerCase()
  if (s.includes('authorized') || s === 'fedramp authorized') return 'text-accent-green bg-accent-green/10'
  if (s.includes('process') || s.includes('in process')) return 'text-accent-gold bg-accent-gold/10'
  if (s.includes('ready')) return 'text-accent-blue bg-accent-blue/10'
  if (s.includes('revoked') || s.includes('expired')) return 'text-accent-red bg-accent-red/10'
  return 'text-muted bg-surface'
}

function impactBadge(level: string): string {
  const l = level.toLowerCase()
  if (l.includes('high') || l === 'il5' || l === 'il6') return 'text-accent-red bg-accent-red/10'
  if (l.includes('moderate') || l === 'il4') return 'text-accent-gold bg-accent-gold/10'
  if (l.includes('low') || l === 'il2') return 'text-accent-blue bg-accent-blue/10'
  return 'text-muted bg-surface'
}

function daysRemainingColor(days: number): string {
  if (days <= 30) return 'text-accent-red'
  if (days <= 60) return 'text-accent-gold'
  if (days <= 90) return 'text-accent-blue'
  return 'text-accent-green'
}

type TabType = 'fedramp' | 'dod' | 'emass' | 'contracts-intel' | 'expiring'

export default function AtoPage() {
  const { setSearchOpen } = useAppStore()

  // Stats
  const [stats, setStats] = useState<AtoStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  // Tab
  const [tab, setTab] = useState<TabType>('fedramp')

  // FedRAMP state
  const [fedrampData, setFedrampData] = useState<FedRAMPRow[]>([])
  const [fedrampTotal, setFedrampTotal] = useState(0)
  const [fedrampPage, setFedrampPage] = useState(1)
  const [fedrampLoading, setFedrampLoading] = useState(false)
  const [fedrampSearch, setFedrampSearch] = useState('')
  const [fedrampStatus, setFedrampStatus] = useState('')
  const [fedrampImpact, setFedrampImpact] = useState('')
  const [fedrampServiceModel, setFedrampServiceModel] = useState('')

  // DoD state
  const [dodData, setDodData] = useState<DoDPARow[]>([])
  const [dodLoading, setDodLoading] = useState(false)
  const [dodSearch, setDodSearch] = useState('')

  // eMASS state
  const [emassData, setEmassData] = useState<EMassRow[]>([])
  const [emassLoading, setEmassLoading] = useState(false)
  const [emassSearch, setEmassSearch] = useState('')

  // Contract Intel state
  const [contractIntelData, setContractIntelData] = useState<ContractIntelRow[]>([])
  const [contractIntelLoading, setContractIntelLoading] = useState(false)
  const [contractIntelSearch, setContractIntelSearch] = useState('')

  // Expiring state
  const [expiringData, setExpiringData] = useState<ExpiringRow[]>([])
  const [expiringLoading, setExpiringLoading] = useState(false)
  const [expiringSearch, setExpiringSearch] = useState('')

  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Fetch stats on mount
  useEffect(() => {
    fetch('/api/ato/stats')
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(console.error)
      .finally(() => setStatsLoading(false))
  }, [])

  // Fetch FedRAMP data
  const fetchFedramp = useCallback(() => {
    setFedrampLoading(true)
    const params = new URLSearchParams()
    if (fedrampStatus) params.set('status', fedrampStatus)
    if (fedrampImpact) params.set('impactLevel', fedrampImpact)
    if (fedrampServiceModel) params.set('serviceModel', fedrampServiceModel)
    if (fedrampSearch) params.set('search', fedrampSearch)
    params.set('page', String(fedrampPage))
    params.set('limit', '50')

    fetch(`/api/ato/fedramp?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setFedrampData(data.authorizations || [])
        setFedrampTotal(data.total || 0)
      })
      .catch(console.error)
      .finally(() => setFedrampLoading(false))
  }, [fedrampStatus, fedrampImpact, fedrampServiceModel, fedrampSearch, fedrampPage])

  useEffect(() => {
    if (tab === 'fedramp') fetchFedramp()
  }, [tab, fetchFedramp])

  // Fetch DoD data
  useEffect(() => {
    if (tab === 'dod') {
      setDodLoading(true)
      fetch('/api/ato/dod-pa')
        .then((r) => r.json())
        .then((data) => setDodData(data.authorizations || []))
        .catch(console.error)
        .finally(() => setDodLoading(false))
    }
  }, [tab])

  // Fetch eMASS data
  useEffect(() => {
    if (tab === 'emass') {
      setEmassLoading(true)
      fetch('/api/ato/emass')
        .then((r) => r.json())
        .then((data) => setEmassData(data.authorizations || []))
        .catch(console.error)
        .finally(() => setEmassLoading(false))
    }
  }, [tab])

  // Fetch Contract Intel data
  useEffect(() => {
    if (tab === 'contracts-intel') {
      setContractIntelLoading(true)
      fetch('/api/ato/contracts-intel')
        .then((r) => r.json())
        .then((data) => setContractIntelData(data.contracts || []))
        .catch(console.error)
        .finally(() => setContractIntelLoading(false))
    }
  }, [tab])

  // Fetch Expiring data
  useEffect(() => {
    if (tab === 'expiring') {
      setExpiringLoading(true)
      fetch('/api/ato/expiring')
        .then((r) => r.json())
        .then((data) => setExpiringData(data.authorizations || []))
        .catch(console.error)
        .finally(() => setExpiringLoading(false))
    }
  }, [tab])

  // Filtered data per tab
  const filteredDod = useMemo(() => {
    if (!dodSearch) return dodData
    const q = dodSearch.toLowerCase()
    return dodData.filter(
      (r) =>
        r.csoName.toLowerCase().includes(q) ||
        r.cspName.toLowerCase().includes(q) ||
        (r.sponsorComponent || '').toLowerCase().includes(q)
    )
  }, [dodData, dodSearch])

  const filteredEmass = useMemo(() => {
    if (!emassSearch) return emassData
    const q = emassSearch.toLowerCase()
    return emassData.filter(
      (r) =>
        r.systemName.toLowerCase().includes(q) ||
        (r.systemId || '').toLowerCase().includes(q) ||
        r.component.toLowerCase().includes(q)
    )
  }, [emassData, emassSearch])

  const filteredContractIntel = useMemo(() => {
    if (!contractIntelSearch) return contractIntelData
    const q = contractIntelSearch.toLowerCase()
    return contractIntelData.filter(
      (r) =>
        r.recipientName.toLowerCase().includes(q) ||
        (r.awardingAgency || '').toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
    )
  }, [contractIntelData, contractIntelSearch])

  const filteredExpiring = useMemo(() => {
    if (!expiringSearch) return expiringData
    const q = expiringSearch.toLowerCase()
    return expiringData.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q)
    )
  }, [expiringData, expiringSearch])

  const fedrampTotalPages = Math.ceil(fedrampTotal / 50)

  const tabLoading =
    (tab === 'fedramp' && fedrampLoading) ||
    (tab === 'dod' && dodLoading) ||
    (tab === 'emass' && emassLoading) ||
    (tab === 'contracts-intel' && contractIntelLoading) ||
    (tab === 'expiring' && expiringLoading)

  const LoadingSkeleton = () => (
    <div className="p-6 space-y-2">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="h-10 bg-surface rounded animate-pulse" />
      ))}
    </div>
  )

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav onSearchOpen={() => setSearchOpen(true)} />
      <SearchCommand />

      <div className="flex-1 pt-12 pb-7 bg-background overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 md:p-6 border-b border-border shrink-0">
          <h1 className="font-mono text-lg md:text-2xl tracking-[0.15em] text-foreground mb-2">
            ATO INTELLIGENCE
          </h1>
          <p className="text-sm text-slate-400 mb-4">
            FedRAMP authorizations, DoD provisional authorities, eMASS system ATOs, and expiring credentials.
          </p>

          {/* Stats */}
          {statsLoading ? (
            <div className="flex flex-wrap gap-4 md:gap-6 mb-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 w-28 bg-surface rounded animate-pulse" />
              ))}
            </div>
          ) : stats ? (
            <div className="flex flex-wrap gap-4 md:gap-6 mb-4">
              <div>
                <span className="font-mono text-lg text-accent-green">{stats.fedramp.byStatus['Authorized'] || 0}</span>
                <span className="text-xs text-muted font-mono ml-2">AUTHORIZED</span>
              </div>
              <div>
                <span className="font-mono text-lg text-accent-gold">{stats.fedramp.byStatus['InProcess'] || 0}</span>
                <span className="text-xs text-muted font-mono ml-2">IN PROCESS</span>
              </div>
              <div>
                <span className="font-mono text-lg text-accent-blue">{stats.fedramp.byStatus['Ready'] || 0}</span>
                <span className="text-xs text-muted font-mono ml-2">READY</span>
              </div>
              <div>
                <span className="font-mono text-lg text-accent-red">{stats.fedramp.expiringWithin90Days}</span>
                <span className="text-xs text-muted font-mono ml-2">EXPIRING 90D</span>
              </div>
              <div>
                <span className="font-mono text-lg text-accent-blue">{stats.dodPa.total}</span>
                <span className="text-xs text-muted font-mono ml-2">DOD PAs</span>
              </div>
              <div>
                <span className="font-mono text-lg text-accent-gold">{stats.emass.total || 'AWAITING'}</span>
                <span className="text-xs text-muted font-mono ml-2">eMASS ATOs</span>
              </div>
            </div>
          ) : null}

          {/* Tabs */}
          <div className="flex items-center gap-2 md:gap-4 mb-4 overflow-x-auto">
            {([
              { key: 'fedramp', label: 'FEDRAMP', color: 'accent-green' },
              { key: 'dod', label: 'DOD CLOUD', color: 'accent-blue' },
              { key: 'emass', label: 'EMASS', color: 'accent-gold' },
              { key: 'contracts-intel', label: 'CONTRACT INTEL', color: 'accent-red' },
              { key: 'expiring', label: 'EXPIRING', color: 'accent-red' },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setExpandedId(null) }}
                className={`font-mono text-[12px] md:text-xs tracking-wider px-2 md:px-3 py-1.5 rounded transition-colors shrink-0 ${
                  tab === t.key
                    ? `text-${t.color} bg-${t.color}/10 border border-${t.color}/30`
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab-specific filters */}
          {tab === 'fedramp' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <select
                  value={fedrampStatus}
                  onChange={(e) => { setFedrampStatus(e.target.value); setFedrampPage(1) }}
                  className="px-2 py-1.5 bg-surface border border-border rounded text-xs font-mono text-foreground focus:outline-none focus:border-accent-green/50"
                >
                  <option value="">ALL STATUS</option>
                  <option value="Authorized">AUTHORIZED</option>
                  <option value="InProcess">IN PROCESS</option>
                  <option value="Ready">READY</option>
                </select>
                <select
                  value={fedrampImpact}
                  onChange={(e) => { setFedrampImpact(e.target.value); setFedrampPage(1) }}
                  className="px-2 py-1.5 bg-surface border border-border rounded text-xs font-mono text-foreground focus:outline-none focus:border-accent-green/50"
                >
                  <option value="">ALL IMPACT</option>
                  <option value="High">HIGH</option>
                  <option value="Moderate">MODERATE</option>
                  <option value="Low">LOW</option>
                  <option value="LI-SaaS">LI-SaaS</option>
                </select>
                <select
                  value={fedrampServiceModel}
                  onChange={(e) => { setFedrampServiceModel(e.target.value); setFedrampPage(1) }}
                  className="px-2 py-1.5 bg-surface border border-border rounded text-xs font-mono text-foreground focus:outline-none focus:border-accent-green/50"
                >
                  <option value="">ALL SERVICE MODELS</option>
                  <option value="IaaS">IaaS</option>
                  <option value="PaaS">PaaS</option>
                  <option value="SaaS">SaaS</option>
                  <option value="IaaS, PaaS">IaaS + PaaS</option>
                </select>
              </div>
              <input
                type="text"
                value={fedrampSearch}
                onChange={(e) => { setFedrampSearch(e.target.value); setFedrampPage(1) }}
                placeholder="Search CSPs, products, agencies..."
                className="w-full max-w-md px-3 py-2 bg-surface border border-border rounded text-sm font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-accent-green/50"
              />
            </div>
          )}

          {tab === 'dod' && (
            <input
              type="text"
              value={dodSearch}
              onChange={(e) => setDodSearch(e.target.value)}
              placeholder="Search CSOs, CSPs, sponsors..."
              className="w-full max-w-md px-3 py-2 bg-surface border border-border rounded text-sm font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-accent-blue/50"
            />
          )}

          {tab === 'emass' && (
            <input
              type="text"
              value={emassSearch}
              onChange={(e) => setEmassSearch(e.target.value)}
              placeholder="Search systems, IDs, components..."
              className="w-full max-w-md px-3 py-2 bg-surface border border-border rounded text-sm font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-accent-gold/50"
            />
          )}

          {tab === 'contracts-intel' && (
            <input
              type="text"
              value={contractIntelSearch}
              onChange={(e) => setContractIntelSearch(e.target.value)}
              placeholder="Search recipients, agencies, descriptions..."
              className="w-full max-w-md px-3 py-2 bg-surface border border-border rounded text-sm font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50"
            />
          )}

          {tab === 'expiring' && (
            <input
              type="text"
              value={expiringSearch}
              onChange={(e) => setExpiringSearch(e.target.value)}
              placeholder="Search names, types, sources..."
              className="w-full max-w-md px-3 py-2 bg-surface border border-border rounded text-sm font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50"
            />
          )}

          {/* Data source */}
          <div className="mt-3 text-[11px] font-mono text-muted tracking-wider">
            {tab === 'fedramp' && (
              <>DATA SOURCE: <span className="text-accent-green">FEDRAMP MARKETPLACE</span> — GSA Authorized Products</>
            )}
            {tab === 'dod' && (
              <>DATA SOURCE: <span className="text-accent-blue">DISA CLOUD CATALOG</span> — DoD Provisional Authorizations</>
            )}
            {tab === 'emass' && (
              <>DATA SOURCE: <span className="text-accent-gold">eMASS</span> — Enterprise Mission Assurance Support Service</>
            )}
            {tab === 'contracts-intel' && (
              <>DATA SOURCE: <span className="text-accent-red">USASPENDING.GOV</span> — Federal ATO-Related Contracts</>
            )}
            {tab === 'expiring' && (
              <>DATA SOURCE: <span className="text-accent-red">COMBINED INTELLIGENCE</span> — All Sources Expiring Authorizations</>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {tabLoading ? (
            <LoadingSkeleton />
          ) : tab === 'fedramp' ? (
            fedrampData.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md">
                  <div className="font-mono text-accent-green text-lg tracking-[0.2em] mb-4">NO FEDRAMP DATA</div>
                  <p className="text-sm text-slate-400 mb-4">
                    FedRAMP authorization data has not been synced yet. Seed or sync from the admin panel.
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <table className="w-full">
                  <thead className="sticky top-0 bg-background border-b border-border z-10">
                    <tr>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">CSP</th>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden md:table-cell">Product</th>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Status</th>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Impact</th>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden lg:table-cell">Service</th>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden lg:table-cell">Sponsor</th>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Auth Date</th>
                      <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Expiration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fedrampData.map((row) => {
                      const isExpanded = expandedId === row.id
                      const expiringSoon = isExpiringSoon(row.expirationDate)
                      return (
                        <React.Fragment key={row.id}>
                          <tr
                            onClick={() => setExpandedId(isExpanded ? null : row.id)}
                            className={`border-b border-border/30 hover:bg-surface/50 transition-colors cursor-pointer ${isExpanded ? 'bg-surface/50' : ''}`}
                          >
                            <td className="px-3 md:px-6 py-2">
                              <span className="text-xs font-mono text-slate-300">{row.cspName}</span>
                            </td>
                            <td className="px-3 md:px-6 py-2 hidden md:table-cell">
                              <span className="text-[13px] text-muted-foreground line-clamp-1">{row.csoName}</span>
                            </td>
                            <td className="px-3 md:px-6 py-2">
                              <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${statusColor(row.status)}`}>
                                {row.status.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                              <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${impactBadge(row.impactLevel || '')}`}>
                                {(row.impactLevel || '—').toUpperCase()}
                              </span>
                            </td>
                            <td className="px-3 md:px-6 py-2 hidden lg:table-cell">
                              <span className="text-[12px] font-mono text-muted">{(() => { try { return JSON.parse(row.serviceModel).join(', ') } catch { return row.serviceModel } })()}</span>
                            </td>
                            <td className="px-3 md:px-6 py-2 hidden lg:table-cell">
                              <span className="text-[12px] font-mono text-accent-blue truncate block max-w-[180px]">{row.sponsoringAgency || '—'}</span>
                            </td>
                            <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                              <span className="text-[12px] font-mono text-muted">
                                {row.authorizationDate ? formatDate(row.authorizationDate) : '—'}
                              </span>
                            </td>
                            <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                              <span className={`text-[12px] font-mono ${expiringSoon ? 'text-accent-red font-bold' : 'text-muted'}`}>
                                {row.expirationDate ? formatDate(row.expirationDate) : '—'}
                              </span>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-surface/30 border-b border-border/30">
                              <td colSpan={8} className="px-4 md:px-8 py-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-3">
                                    <div>
                                      <span className="text-[11px] font-mono text-muted tracking-wider">CSP NAME</span>
                                      <p className="text-xs font-mono text-foreground mt-0.5">{row.cspName}</p>
                                    </div>
                                    <div>
                                      <span className="text-[11px] font-mono text-muted tracking-wider">PRODUCT NAME</span>
                                      <p className="text-xs font-mono text-foreground mt-0.5">{row.csoName}</p>
                                    </div>
                                    <div>
                                      <span className="text-[11px] font-mono text-muted tracking-wider">SERVICE MODEL</span>
                                      <p className="text-xs font-mono text-foreground mt-0.5">{(() => { try { return JSON.parse(row.serviceModel).join(', ') } catch { return row.serviceModel } })()}</p>
                                    </div>
                                  </div>
                                  <div className="space-y-3">
                                    <div>
                                      <span className="text-[11px] font-mono text-muted tracking-wider">SPONSORING AGENCY</span>
                                      <p className="text-xs font-mono text-accent-blue mt-0.5">{row.sponsoringAgency || '—'}</p>
                                    </div>
                                    <div className="flex gap-6">
                                      <div>
                                        <span className="text-[11px] font-mono text-muted tracking-wider">AUTH DATE</span>
                                        <p className="text-xs font-mono text-foreground mt-0.5">{row.authorizationDate ? formatDate(row.authorizationDate) : '—'}</p>
                                      </div>
                                      <div>
                                        <span className="text-[11px] font-mono text-muted tracking-wider">EXPIRATION</span>
                                        <p className={`text-xs font-mono mt-0.5 ${expiringSoon ? 'text-accent-red font-bold' : 'text-foreground'}`}>
                                          {row.expirationDate ? formatDate(row.expirationDate) : '—'}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex gap-6">
                                      <div>
                                        <span className="text-[11px] font-mono text-muted tracking-wider">IMPACT LEVEL</span>
                                        <p className="text-xs font-mono text-foreground mt-0.5">{row.impactLevel || '—'}</p>
                                      </div>
                                      <div>
                                        <span className="text-[11px] font-mono text-muted tracking-wider">STATUS</span>
                                        <p className="text-xs font-mono text-foreground mt-0.5">{row.status}</p>
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

                {/* Pagination */}
                {fedrampTotalPages > 1 && (
                  <div className="flex items-center justify-between px-4 md:px-6 py-3 border-t border-border">
                    <button
                      onClick={() => setFedrampPage((p) => Math.max(1, p - 1))}
                      disabled={fedrampPage <= 1}
                      className="px-3 py-1.5 text-[12px] font-mono tracking-wider text-muted border border-border rounded hover:text-foreground hover:border-border-bright disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      PREV
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(fedrampTotalPages, 7) }).map((_, i) => {
                        let pageNum: number
                        if (fedrampTotalPages <= 7) {
                          pageNum = i + 1
                        } else if (fedrampPage <= 4) {
                          pageNum = i + 1
                        } else if (fedrampPage >= fedrampTotalPages - 3) {
                          pageNum = fedrampTotalPages - 6 + i
                        } else {
                          pageNum = fedrampPage - 3 + i
                        }
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setFedrampPage(pageNum)}
                            className={`w-7 h-7 text-[12px] font-mono rounded transition-colors ${
                              fedrampPage === pageNum
                                ? 'text-accent-green bg-accent-green/10 border border-accent-green/30'
                                : 'text-muted hover:text-foreground'
                            }`}
                          >
                            {pageNum}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => setFedrampPage((p) => Math.min(fedrampTotalPages, p + 1))}
                      disabled={fedrampPage >= fedrampTotalPages}
                      className="px-3 py-1.5 text-[12px] font-mono tracking-wider text-muted border border-border rounded hover:text-foreground hover:border-border-bright disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      NEXT
                    </button>
                  </div>
                )}
              </div>
            )
          ) : tab === 'dod' ? (
            filteredDod.length === 0 && !dodLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md">
                  <div className="font-mono text-accent-blue text-lg tracking-[0.2em] mb-4">NO DOD PA DATA</div>
                  <p className="text-sm text-slate-400">
                    DoD Provisional Authorization data has not been imported. Use the admin panel to import DISA PA CSV data.
                  </p>
                </div>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-background border-b border-border z-10">
                  <tr>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">CSO</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">CSP</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">IL Level</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">PA Date</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Expiration</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden md:table-cell">Sponsor</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden lg:table-cell">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDod.map((row) => (
                    <tr key={row.id} className="border-b border-border/30 hover:bg-surface/50 transition-colors">
                      <td className="px-3 md:px-6 py-2">
                        <span className="text-xs font-mono text-slate-300">{row.csoName}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2">
                        <span className="text-xs font-mono text-muted-foreground">{row.cspName}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2">
                        <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${impactBadge(row.impactLevel)}`}>
                          {row.impactLevel.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                        <span className="text-[12px] font-mono text-muted">{row.paDate ? formatDate(row.paDate) : '—'}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                        <span className={`text-[12px] font-mono ${isExpiringSoon(row.paExpiration) ? 'text-accent-red font-bold' : 'text-muted'}`}>
                          {row.paExpiration ? formatDate(row.paExpiration) : '—'}
                        </span>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden md:table-cell">
                        <span className="text-[12px] font-mono text-accent-blue truncate block max-w-[150px]">{row.sponsorComponent || 'DISA'}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden lg:table-cell">
                        <span className="text-[12px] font-mono text-muted">{row.source}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : tab === 'emass' ? (
            filteredEmass.length === 0 && !emassLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md">
                  <div className="font-mono text-accent-gold text-lg tracking-[0.2em] mb-4">NO eMASS DATA</div>
                  <p className="text-sm text-slate-400">
                    eMASS ATO data has not been imported. Use the admin panel to upload eMASS CSV data.
                  </p>
                </div>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-background border-b border-border z-10">
                  <tr>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">System Name</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">System ID</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden md:table-cell">Component</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Auth Type</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Auth Date</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Expiration</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmass.map((row) => (
                    <tr key={row.id} className="border-b border-border/30 hover:bg-surface/50 transition-colors">
                      <td className="px-3 md:px-6 py-2">
                        <span className="text-xs font-mono text-slate-300">{row.systemName}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                        <span className="text-[12px] font-mono text-muted">{row.systemId}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden md:table-cell">
                        <span className="text-[12px] font-mono text-accent-blue">{row.component}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2">
                        <span className="text-[12px] font-mono text-muted-foreground">{row.authorizationType}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                        <span className="text-[12px] font-mono text-muted">{row.authorizationDate ? formatDate(row.authorizationDate) : '—'}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                        <span className={`text-[12px] font-mono ${isExpiringSoon(row.expirationDate) ? 'text-accent-red font-bold' : 'text-muted'}`}>
                          {row.expirationDate ? formatDate(row.expirationDate) : '—'}
                        </span>
                      </td>
                      <td className="px-3 md:px-6 py-2">
                        <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${impactBadge(row.impactLevel || '')}`}>
                          {(row.impactLevel || '—').toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : tab === 'contracts-intel' ? (
            filteredContractIntel.length === 0 && !contractIntelLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md">
                  <div className="font-mono text-accent-red text-lg tracking-[0.2em] mb-4">NO CONTRACT INTEL</div>
                  <p className="text-sm text-slate-400">
                    ATO-related federal contract data has not been synced yet.
                  </p>
                </div>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-background border-b border-border z-10">
                  <tr>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Recipient</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Agency</th>
                    <th className="text-right px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Amount</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden md:table-cell">Description</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Relevance</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Start Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContractIntel.map((row) => (
                    <tr key={row.id} className="border-b border-border/30 hover:bg-surface/50 transition-colors">
                      <td className="px-3 md:px-6 py-2">
                        <span className="text-xs font-mono text-slate-300">{row.recipientName}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                        <span className="text-[12px] font-mono text-accent-blue">{row.awardingAgency || '—'}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2 text-right">
                        {row.awardAmount ? (
                          <span className="text-xs font-mono text-accent-green font-bold">{formatCurrency(row.awardAmount)}</span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 md:px-6 py-2 max-w-sm hidden md:table-cell">
                        <span className="text-[13px] text-muted-foreground line-clamp-2">{row.description || '—'}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-surface rounded overflow-hidden">
                            <div
                              className="h-full rounded transition-all"
                              style={{
                                width: `${row.atoRelevanceScore}%`,
                                backgroundColor:
                                  row.atoRelevanceScore >= 80
                                    ? '#2ECC71'
                                    : row.atoRelevanceScore >= 50
                                    ? '#B8953E'
                                    : '#C8102E',
                              }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-muted">{row.atoRelevanceScore}%</span>
                        </div>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                        <span className="text-[12px] font-mono text-muted">{row.startDate ? formatDate(row.startDate) : '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : tab === 'expiring' ? (
            filteredExpiring.length === 0 && !expiringLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md">
                  <div className="font-mono text-accent-red text-lg tracking-[0.2em] mb-4">NO EXPIRING AUTHORIZATIONS</div>
                  <p className="text-sm text-slate-400">
                    No authorizations are currently expiring within the tracked window.
                  </p>
                </div>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-background border-b border-border z-10">
                  <tr>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Source</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Name</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Type</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Expiration</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase">Days Left</th>
                    <th className="text-left px-3 md:px-6 py-2 md:py-3 text-[12px] font-mono tracking-wider text-muted uppercase hidden sm:table-cell">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExpiring.map((row, idx) => (
                    <tr key={`${row.source}-${row.name}-${idx}`} className="border-b border-border/30 hover:bg-surface/50 transition-colors">
                      <td className="px-3 md:px-6 py-2">
                        <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          row.source === 'fedramp' ? 'text-accent-green bg-accent-green/10'
                          : row.source === 'dod-pa' ? 'text-accent-blue bg-accent-blue/10'
                          : 'text-accent-gold bg-accent-gold/10'
                        }`}>
                          {row.source.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 md:px-6 py-2">
                        <span className="text-xs font-mono text-slate-300">{row.name}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                        <span className="text-[12px] font-mono text-muted">{row.type}</span>
                      </td>
                      <td className="px-3 md:px-6 py-2">
                        <span className="text-[12px] font-mono text-accent-red font-bold">
                          {formatDate(row.expirationDate)}
                        </span>
                      </td>
                      <td className="px-3 md:px-6 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 bg-surface rounded overflow-hidden">
                            <div
                              className="h-full rounded transition-all"
                              style={{
                                width: `${Math.max(5, Math.min(100, (row.daysRemaining / 90) * 100))}%`,
                                backgroundColor:
                                  row.daysRemaining <= 30 ? '#C8102E'
                                  : row.daysRemaining <= 60 ? '#B8953E'
                                  : '#4A7C9B',
                              }}
                            />
                          </div>
                          <span className={`text-[12px] font-mono font-bold ${daysRemainingColor(row.daysRemaining)}`}>
                            {row.daysRemaining}d
                          </span>
                        </div>
                      </td>
                      <td className="px-3 md:px-6 py-2 hidden sm:table-cell">
                        <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${impactBadge(row.impactLevel || '')}`}>
                          {(row.impactLevel || '—').toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : null}
        </div>
      </div>

      <BottomBar />
    </div>
  )
}
