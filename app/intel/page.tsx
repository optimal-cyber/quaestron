'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import SearchCommand from '@/components/layout/SearchCommand'
import { useAppStore } from '@/lib/store'

interface FeedItem {
  title: string
  link: string
  pubDate: string
  source: string
  category: string
  description: string
}

const CATEGORY_COLORS: Record<string, string> = {
  CYBER: '#C8102E',
  THREAT_INTEL: '#FF6B35',
  VULN: '#E74C3C',
  DEFENSE: '#4A7C9B',
  OSINT: '#2ECC71',
  SURVEILLANCE: '#B8953E',
  POLICY: '#8B5CF6',
  AI_POLICY: '#06B6D4',
}

const CATEGORY_LABELS: Record<string, string> = {
  CYBER: 'Cybersecurity',
  THREAT_INTEL: 'Threat Intel',
  VULN: 'Vulnerabilities',
  DEFENSE: 'Defense',
  OSINT: 'OSINT',
  SURVEILLANCE: 'Surveillance & Privacy',
  POLICY: 'Policy & EOs',
  AI_POLICY: 'AI Policy & Governance',
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

// ── Live Ticker Banner ─────────────────────────────────────────
function LiveTicker({ items }: { items: FeedItem[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || paused) return

    let animFrame: number
    let lastTime = performance.now()

    const scroll = (now: number) => {
      const delta = now - lastTime
      lastTime = now
      el.scrollLeft += delta * 0.04 // pixels per ms
      // Loop back when halfway through (content is duplicated)
      if (el.scrollLeft >= el.scrollWidth / 2) {
        el.scrollLeft = 0
      }
      animFrame = requestAnimationFrame(scroll)
    }
    animFrame = requestAnimationFrame(scroll)
    return () => cancelAnimationFrame(animFrame)
  }, [paused, items])

  if (items.length === 0) return null

  const tickerItems = items.slice(0, 30)

  return (
    <div
      className="relative border-b border-border bg-[#0a0e17] shrink-0"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* LIVE indicator */}
      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center bg-gradient-to-r from-[#0a0e17] via-[#0a0e17] to-transparent pr-4 pl-3">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          <span className="font-mono text-[12px] tracking-[0.2em] text-red-400 font-bold">LIVE</span>
        </div>
      </div>

      {/* Scrolling ticker */}
      <div
        ref={scrollRef}
        className="overflow-hidden whitespace-nowrap py-2 pl-20"
        style={{ scrollBehavior: 'auto' }}
      >
        {/* Duplicate items for seamless loop */}
        {[...tickerItems, ...tickerItems].map((item, i) => (
          <a
            key={i}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mr-8 hover:text-foreground transition-colors group"
          >
            <span
              className="w-1 h-1 rounded-full shrink-0"
              style={{ backgroundColor: CATEGORY_COLORS[item.category] || '#64748B' }}
            />
            <span className="text-[13px] font-mono text-muted-foreground group-hover:text-foreground transition-colors">
              {item.title}
            </span>
            <span className="text-[11px] font-mono text-muted">{timeAgo(item.pubDate)}</span>
            <span
              className="text-[8px] font-mono px-1 py-0.5 rounded"
              style={{
                color: CATEGORY_COLORS[item.category],
                backgroundColor: CATEGORY_COLORS[item.category] + '15',
              }}
            >
              {item.source}
            </span>
          </a>
        ))}
      </div>

      {/* Fade edges */}
      <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-[#0a0e17] to-transparent pointer-events-none" />
    </div>
  )
}

// ── Priority Alert Banner ──────────────────────────────────────
function PriorityAlerts({ items }: { items: FeedItem[] }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const priorities = items.filter(
    (i) =>
      i.category === 'THREAT_INTEL' ||
      i.category === 'VULN' ||
      i.title.toLowerCase().includes('critical') ||
      i.title.toLowerCase().includes('zero-day') ||
      i.title.toLowerCase().includes('0-day') ||
      i.title.toLowerCase().includes('actively exploited') ||
      i.title.toLowerCase().includes('emergency') ||
      i.title.toLowerCase().includes('ransomware') ||
      i.title.toLowerCase().includes('executive order') ||
      i.title.toLowerCase().includes('sanctions') ||
      i.title.toLowerCase().includes('indictment')
  ).slice(0, 10)

  useEffect(() => {
    if (priorities.length <= 1) return
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % priorities.length)
    }, 6000)
    return () => clearInterval(interval)
  }, [priorities.length])

  if (priorities.length === 0) return null

  const item = priorities[currentIndex]

  return (
    <div className="border-b border-border bg-red-950/20 shrink-0">
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-4 py-2 hover:bg-red-950/30 transition-colors"
      >
        <div className="flex items-center gap-1.5 shrink-0">
          <svg className="w-3.5 h-3.5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="text-[12px] font-mono tracking-[0.15em] text-red-400 font-bold">PRIORITY</span>
        </div>
        <span className="text-[13px] font-mono text-red-200/80 truncate">{item.title}</span>
        <span className="text-[11px] font-mono text-red-400/60 shrink-0">{item.source}</span>
        <span className="text-[11px] font-mono text-muted shrink-0">{timeAgo(item.pubDate)}</span>
        {priorities.length > 1 && (
          <span className="text-[8px] font-mono text-red-400/40 shrink-0 ml-auto">
            {currentIndex + 1}/{priorities.length}
          </span>
        )}
      </a>
    </div>
  )
}

export default function IntelPage() {
  const { setSearchOpen } = useAppStore()
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now())

  const fetchFeeds = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await fetch('/api/intel-feeds')
      const data = await res.json()
      setItems(data.items || [])
      setFetchedAt(data.fetchedAt)
      setLastRefresh(Date.now())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchFeeds()
  }, [fetchFeeds])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetchFeeds(true)
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchFeeds])

  const filtered = items.filter((item) => {
    if (categoryFilter && item.category !== categoryFilter) return false
    if (filter) {
      const q = filter.toLowerCase()
      return (
        item.title.toLowerCase().includes(q) ||
        item.source.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      )
    }
    return true
  })

  const categories = Object.keys(CATEGORY_COLORS)
  const sourceCounts = new Map<string, number>()
  for (const item of items) {
    sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1)
  }

  const nextRefreshIn = Math.max(0, Math.ceil((5 * 60 * 1000 - (Date.now() - lastRefresh)) / 60000))

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav onSearchOpen={() => setSearchOpen(true)} />
      <SearchCommand />

      <div className="flex-1 pt-12 pb-7 bg-background overflow-hidden flex flex-col">
        {/* Live Ticker */}
        <LiveTicker items={items} />

        {/* Priority Alerts */}
        <PriorityAlerts items={items} />

        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Left sidebar - sources (hidden on mobile) */}
          <div className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-border overflow-hidden bg-surface/50">
            <div className="p-4 overflow-y-auto flex-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-mono text-xs tracking-[0.2em] text-accent-red">
                  INTEL FEEDS
                </h2>
                <button
                  onClick={() => fetchFeeds(true)}
                  disabled={refreshing}
                  className="text-[11px] font-mono text-muted hover:text-foreground transition-colors disabled:opacity-50"
                  title="Refresh feeds"
                >
                  {refreshing ? (
                    <span className="inline-block animate-spin">&#8635;</span>
                  ) : (
                    '&#8635; REFRESH'
                  )}
                </button>
              </div>

              <div className="flex items-center gap-2 mb-4">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                </span>
                <p className="text-[12px] text-muted font-mono">
                  {items.length} items &bull; {sourceCounts.size} sources &bull; auto-refresh {nextRefreshIn}m
                </p>
              </div>

              {/* Category filters */}
              <div className="space-y-0.5 mb-6">
                <button
                  onClick={() => setCategoryFilter(null)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono transition-colors ${
                    !categoryFilter ? 'text-foreground bg-surface-hover' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All Categories
                </button>
                {categories.map((cat) => {
                  const count = items.filter((i) => i.category === cat).length
                  if (count === 0) return null
                  return (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono transition-colors flex items-center justify-between ${
                        categoryFilter === cat
                          ? 'text-foreground bg-surface-hover'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                        />
                        {CATEGORY_LABELS[cat]}
                      </div>
                      <span className="text-[12px] text-muted">{count}</span>
                    </button>
                  )
                })}
              </div>

              {/* Sources */}
              <div className="border-t border-border pt-4">
                <div className="text-[12px] font-mono tracking-wider text-muted mb-3 uppercase">Sources ({sourceCounts.size})</div>
                <div className="space-y-0.5">
                  {Array.from(sourceCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([source, count]) => (
                      <button
                        key={source}
                        onClick={() => setFilter(source)}
                        className="w-full flex items-center justify-between text-[12px] font-mono text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-surface-hover"
                      >
                        <span className="truncate">{source}</span>
                        <span className="text-muted ml-2 shrink-0">{count}</span>
                      </button>
                    ))}
                </div>
              </div>

              {fetchedAt && (
                <div className="mt-6 pt-4 border-t border-border">
                  <div className="text-[11px] font-mono text-muted">
                    Last fetched: {timeAgo(fetchedAt)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Main feed */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Mobile category filter chips */}
            <div className="md:hidden border-b border-border px-3 py-2 overflow-x-auto shrink-0">
              <div className="flex gap-2">
                <button
                  onClick={() => setCategoryFilter(null)}
                  className={`shrink-0 px-2.5 py-1 rounded text-[12px] font-mono tracking-wider transition-colors ${
                    !categoryFilter ? 'bg-accent-red/15 border border-accent-red/30 text-accent-red' : 'bg-surface border border-border text-muted-foreground'
                  }`}
                >
                  ALL
                </button>
                {categories.map((cat) => {
                  const count = items.filter((i) => i.category === cat).length
                  if (count === 0) return null
                  return (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                      className={`shrink-0 px-2.5 py-1 rounded text-[12px] font-mono tracking-wider transition-colors ${
                        categoryFilter === cat
                          ? 'border'
                          : 'bg-surface border border-border text-muted-foreground'
                      }`}
                      style={categoryFilter === cat ? {
                        color: CATEGORY_COLORS[cat],
                        borderColor: CATEGORY_COLORS[cat] + '40',
                        backgroundColor: CATEGORY_COLORS[cat] + '15',
                      } : undefined}
                    >
                      {cat.replace('_', ' ')}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Search bar + stats */}
            <div className="p-3 md:p-4 border-b border-border shrink-0">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search intel feeds... (source, keyword, CVE)"
                  className="flex-1 max-w-lg px-3 py-2 bg-surface border border-border rounded text-sm font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50"
                />
                <div className="hidden md:flex items-center gap-3 text-[12px] font-mono text-muted">
                  <span>{filtered.length} results</span>
                  {refreshing && (
                    <span className="text-accent-green animate-pulse">syncing...</span>
                  )}
                </div>
              </div>
              {(categoryFilter || filter) && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {categoryFilter && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-mono border"
                      style={{
                        color: CATEGORY_COLORS[categoryFilter],
                        borderColor: CATEGORY_COLORS[categoryFilter] + '40',
                        backgroundColor: CATEGORY_COLORS[categoryFilter] + '10',
                      }}
                    >
                      {CATEGORY_LABELS[categoryFilter]}
                      <button onClick={() => setCategoryFilter(null)} className="ml-1 hover:opacity-70">&times;</button>
                    </span>
                  )}
                  {filter && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-mono border border-border text-muted-foreground">
                      &ldquo;{filter}&rdquo;
                      <button onClick={() => setFilter('')} className="ml-1 hover:opacity-70">&times;</button>
                    </span>
                  )}
                  <button
                    onClick={() => { setCategoryFilter(null); setFilter('') }}
                    className="text-[12px] font-mono text-muted hover:text-foreground"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>

            {/* Feed items */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 15 }).map((_, i) => (
                    <div key={i} className="h-16 bg-surface rounded animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="font-mono text-xs text-muted tracking-[0.2em] mb-2">NO RESULTS</div>
                    <p className="text-sm text-muted-foreground">
                      {items.length === 0
                        ? 'Could not fetch OSINT feeds. Check your network connection.'
                        : 'Try adjusting your search or category filter.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {filtered.map((item, i) => (
                    <a
                      key={i}
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-3 md:px-6 py-3 hover:bg-surface/50 transition-colors group"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="w-1.5 h-1.5 rounded-full mt-2 shrink-0"
                          style={{ backgroundColor: CATEGORY_COLORS[item.category] || '#64748B' }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-muted-foreground group-hover:text-foreground transition-colors leading-snug mb-1">
                            {item.title}
                          </div>
                          {item.description && (
                            <div className="text-[13px] text-muted leading-relaxed mb-1.5 line-clamp-2">
                              {item.description}
                            </div>
                          )}
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-[12px] font-mono text-accent-blue">{item.source}</span>
                            <span
                              className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                              style={{
                                color: CATEGORY_COLORS[item.category],
                                backgroundColor: CATEGORY_COLORS[item.category] + '15',
                              }}
                            >
                              {item.category.replace('_', ' ')}
                            </span>
                            {item.pubDate && (
                              <span className="text-[12px] font-mono text-muted">{timeAgo(item.pubDate)}</span>
                            )}
                          </div>
                        </div>
                        <svg
                          className="w-3.5 h-3.5 text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <BottomBar />
    </div>
  )
}
