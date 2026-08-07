'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import SearchCommand from '@/components/layout/SearchCommand'
import { slugify } from '@/lib/match/vendor-name'

interface VendorRow {
  name: string
  slug: string
  type: string
  businessSize: string | null
  setAsides: string[]
  riskFlags: string[]
  primaryAgency: string | null
  totalFederalObligated: number | null
  enriched: boolean
  country: { alpha2: string; name: string } | null
}

function fmt(v: number | null): string {
  if (!v) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

type Filter = 'all' | 'small' | 'risk'

export default function VendorsPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '60', sort: 'obligated' })
    if (search) params.set('search', search)
    if (filter === 'small') params.set('size', 'SMALL')
    if (filter === 'risk') params.set('risk', '1')
    fetch(`/api/vendors?${params}`)
      .then((r) => r.json())
      .then((d) => { setVendors(d.vendors || []); setTotal(d.total || 0) })
      .finally(() => setLoading(false))
  }, [search, filter])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav onSearchOpen={() => setSearchOpen(true)} />
      <SearchCommand />

      <div className="flex-1 pt-12 pb-7 bg-background overflow-hidden flex flex-col">
        <div className="p-4 md:p-6 border-b border-border shrink-0">
          <h1 className="font-mono text-lg md:text-2xl tracking-[0.15em] text-foreground mb-2">VENDOR INTELLIGENCE</h1>
          <p className="text-sm text-slate-400 mb-4 max-w-3xl">
            Market research and vendor due diligence for federal acquisition — SAM registration, small-business status,
            FedRAMP/DoD authorizations, SBIR pedigree, agencies supported, and ownership risk. Search any vendor to build a live dossier.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendors by name…"
              className="w-full max-w-md px-3 py-2 bg-surface border border-border rounded text-sm font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-accent-blue/50"
            />
            <div className="flex items-center gap-2">
              {(['all', 'small', 'risk'] as Filter[]).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`font-mono text-[12px] md:text-xs tracking-wider px-3 py-1.5 rounded transition-colors ${
                    filter === f ? 'text-accent-blue bg-accent-blue/10 border border-accent-blue/30' : 'text-muted hover:text-foreground'
                  }`}>
                  {f === 'all' ? 'ALL' : f === 'small' ? 'SMALL BUSINESS' : 'HAS RISK'}
                </button>
              ))}
            </div>
            <span className="text-[12px] font-mono text-muted ml-auto">{total.toLocaleString()} vendors</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* On-demand build affordance when a search returns nothing */}
          {!loading && search && vendors.length === 0 && (
            <div className="max-w-3xl mx-auto p-8 text-center">
              <p className="text-sm text-muted-foreground mb-3">No tracked vendor matches “{search}”.</p>
              <button
                onClick={() => router.push(`/vendor/${slugify(search)}?name=${encodeURIComponent(search)}`)}
                className="font-mono text-xs tracking-wider px-4 py-2 rounded bg-accent-green/10 text-accent-green border border-accent-green/30 hover:bg-accent-green/20 transition-colors"
              >
                BUILD LIVE DOSSIER FOR “{search.toUpperCase()}” →
              </button>
              <p className="text-[12px] text-muted mt-2 font-mono">Pulls SAM, USAspending, FedRAMP & SBIR on demand.</p>
            </div>
          )}

          {vendors.length > 0 && (
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr className="text-[12px] font-mono text-muted uppercase tracking-wider">
                  <th className="px-4 md:px-6 py-2">Vendor</th>
                  <th className="px-3 py-2 hidden md:table-cell">Size</th>
                  <th className="px-3 py-2 hidden lg:table-cell">Primary Agency</th>
                  <th className="px-3 py-2 text-right">Federal $</th>
                  <th className="px-3 py-2">Risk</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.slug}
                    onClick={() => router.push(`/vendor/${v.slug}`)}
                    className="border-b border-border/50 hover:bg-surface-hover cursor-pointer transition-colors">
                    <td className="px-4 md:px-6 py-2.5">
                      <div className="font-mono text-xs text-foreground">{v.name}</div>
                      <div className="text-[12px] text-muted font-mono">
                        {v.type.replace(/_/g, ' ')}
                        {v.country && v.country.alpha2 !== 'US' ? ` · ${v.country.name}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      {v.businessSize === 'SMALL'
                        ? <span className="text-[12px] font-mono text-accent-green">SMALL</span>
                        : v.businessSize
                        ? <span className="text-[12px] font-mono text-muted">OTHER</span>
                        : <span className="text-[12px] font-mono text-muted/50">—</span>}
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <span className="text-[12px] font-mono text-accent-blue truncate block max-w-[200px]">{v.primaryAgency || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-[13px] font-mono text-accent-green">{fmt(v.totalFederalObligated)}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {v.riskFlags.length > 0
                        ? <span className="text-[12px] font-mono text-accent-red">⚠ {v.riskFlags.length}</span>
                        : <span className="text-[12px] font-mono text-muted/50">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {loading && vendors.length === 0 && (
            <div className="p-6 space-y-2 max-w-5xl mx-auto">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-surface/40 rounded animate-pulse" />
              ))}
            </div>
          )}
        </div>
      </div>

      <BottomBar />
    </div>
  )
}
