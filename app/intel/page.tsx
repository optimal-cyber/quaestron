'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import SearchCommand from '@/components/layout/SearchCommand'
import { useAppStore } from '@/lib/store'
import {
  CATEGORY_ORDER,
  categoryColor,
  categoryLabel,
  categoryShort,
  formatDateline,
  groupByCategory,
  matchesQuery,
  parseDate,
  priorityScore,
  rankFrontPage,
  timeAgo,
  type FeedItem,
} from './feed'

/**
 * /intel is laid out as a newspaper front page rather than a feed reader:
 * a masthead and dateline, a section nav, one lead story, a row of top
 * stories, a "Latest" column, then one section per category. Choosing a
 * section or searching swaps the front page for a single-column edition of
 * the matching stories. Every headline links straight to the primary source,
 * and the source is printed on every story, so readers can check it themselves.
 */

const REFRESH_MS = 5 * 60 * 1000
const TOP_STORIES = 4
const LATEST_COUNT = 14
const SECTION_PREVIEW = 6

function hostname(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// ── Story atoms ────────────────────────────────────────────────

function Kicker({ category, children }: { category: string; children?: React.ReactNode }) {
  return (
    <span
      className="font-mono text-[11px] tracking-[0.2em] uppercase"
      style={{ color: categoryColor(category) }}
    >
      {children ?? categoryShort(category)}
    </span>
  )
}

function Byline({ item, now, showCategory = false }: { item: FeedItem; now: Date; showCategory?: boolean }) {
  const ago = timeAgo(item.pubDate, now)
  return (
    <div className="flex items-center gap-x-2 flex-wrap font-mono text-[12px] text-muted">
      <span className="text-muted-foreground">{item.source}</span>
      {ago && (
        <>
          <span aria-hidden>·</span>
          <time dateTime={parseDate(item.pubDate)?.toISOString()}>{ago}</time>
        </>
      )}
      {showCategory && (
        <>
          <span aria-hidden>·</span>
          <Kicker category={item.category} />
        </>
      )}
    </div>
  )
}

function LeadStory({ item, now, developing }: { item: FeedItem; now: Date; developing: boolean }) {
  const host = hostname(item.link)
  return (
    <article>
      <Kicker category={item.category}>
        {developing ? 'Developing' : 'Lead story'} — {categoryShort(item.category)}
      </Kicker>
      <h2 className="font-serif text-3xl md:text-[2.75rem] leading-[1.08] tracking-tight text-foreground mt-2 mb-4">
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:underline decoration-1 underline-offset-4">
          {item.title}
        </a>
      </h2>
      {item.description && (
        <p className="font-serif text-lg md:text-xl leading-relaxed text-muted-foreground mb-4 max-w-2xl">
          {item.description}
        </p>
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Byline item={item} now={now} />
        {host && (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[12px] text-accent-blue hover:text-foreground transition-colors"
          >
            Read at {host} &rarr;
          </a>
        )}
      </div>
    </article>
  )
}

function StoryCard({ item, now }: { item: FeedItem; now: Date }) {
  return (
    <article className="flex flex-col gap-2">
      <Kicker category={item.category} />
      <h3 className="font-serif text-xl md:text-2xl leading-tight text-foreground">
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:underline decoration-1 underline-offset-4">
          {item.title}
        </a>
      </h3>
      {item.description && (
        <p className="text-[15px] leading-relaxed text-muted-foreground line-clamp-3">{item.description}</p>
      )}
      <Byline item={item} now={now} />
    </article>
  )
}

function CompactStory({ item, now }: { item: FeedItem; now: Date }) {
  return (
    <article className="flex flex-col gap-1.5">
      <h4 className="font-serif text-lg leading-snug text-foreground">
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:underline decoration-1 underline-offset-4">
          {item.title}
        </a>
      </h4>
      <Byline item={item} now={now} />
    </article>
  )
}

function LatestRow({ item, now }: { item: FeedItem; now: Date }) {
  return (
    <li className="py-3 first:pt-0">
      <a href={item.link} target="_blank" rel="noopener noreferrer" className="group block">
        <div className="flex items-baseline gap-3">
          <time
            dateTime={parseDate(item.pubDate)?.toISOString()}
            className="font-mono text-[11px] text-muted w-14 shrink-0 tabular-nums"
          >
            {timeAgo(item.pubDate, now)}
          </time>
          <div className="min-w-0">
            <div className="font-serif text-[15px] leading-snug text-foreground group-hover:underline decoration-1 underline-offset-4">
              {item.title}
            </div>
            <div className="font-mono text-[11px] text-muted mt-0.5 flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: categoryColor(item.category) }}
                aria-hidden
              />
              {item.source}
            </div>
          </div>
        </div>
      </a>
    </li>
  )
}

function ListStory({ item, now }: { item: FeedItem; now: Date }) {
  const host = hostname(item.link)
  return (
    <article className="py-6 grid grid-cols-1 md:grid-cols-12 gap-x-8 gap-y-2">
      <div className="md:col-span-2">
        <Kicker category={item.category} />
      </div>
      <div className="md:col-span-10">
        <h3 className="font-serif text-2xl leading-tight text-foreground mb-2">
          <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:underline decoration-1 underline-offset-4">
            {item.title}
          </a>
        </h3>
        {item.description && (
          <p className="text-[15px] leading-relaxed text-muted-foreground mb-2 max-w-2xl line-clamp-3">{item.description}</p>
        )}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Byline item={item} now={now} />
          {host && <span className="font-mono text-[11px] text-muted">{host}</span>}
        </div>
      </div>
    </article>
  )
}

function SectionRule({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-baseline justify-between border-t-2 border-foreground/70 pt-3 mb-5">
      <h2 className="font-serif text-2xl text-foreground">{title}</h2>
      {action && onAction && (
        <button onClick={onAction} className="font-mono text-[12px] text-muted hover:text-foreground transition-colors">
          {action} &rarr;
        </button>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────

export default function IntelPage() {
  const { setSearchOpen } = useAppStore()
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const fetchFeeds = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await fetch('/api/intel-feeds')
      if (!res.ok) throw new Error(`intel-feeds ${res.status}`)
      const data = await res.json()
      setItems(data.items || [])
      setFetchedAt(data.fetchedAt)
      setFailed(false)
      setNow(new Date())
    } catch (err) {
      console.error(err)
      setFailed(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchFeeds()
    const refresh = setInterval(() => fetchFeeds(true), REFRESH_MS)
    // Keep "3m ago" honest between refreshes without re-fetching.
    const tick = setInterval(() => setNow(new Date()), 30_000)
    return () => {
      clearInterval(refresh)
      clearInterval(tick)
    }
  }, [fetchFeeds])

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.source, (counts.get(item.source) || 0) + 1)
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [items])

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.category, (counts.get(item.category) || 0) + 1)
    return counts
  }, [items])

  const filtering = Boolean(category || query.trim())
  const filtered = useMemo(
    () => items.filter((item) => (!category || item.category === category) && matchesQuery(item, query)),
    [items, category, query]
  )

  const frontPage = useMemo(() => rankFrontPage(items, TOP_STORIES, now), [items, now])
  const sections = useMemo(() => groupByCategory(frontPage.rest), [frontPage])
  const latest = useMemo(() => items.slice(0, LATEST_COUNT), [items])

  const clearFilters = () => {
    setCategory(null)
    setQuery('')
  }

  const editionTitle = category
    ? categoryLabel(category)
    : query.trim()
      ? `Search: “${query.trim()}”`
      : 'Front page'

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav onSearchOpen={() => setSearchOpen(true)} />
      <SearchCommand />

      <main className="flex-1 pt-12 pb-7 bg-background">
        <div className="max-w-6xl mx-auto px-4 md:px-8">
          {/* Masthead */}
          <header className="pt-8 md:pt-12 pb-5 border-b-2 border-foreground/80">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <div className="font-mono text-[11px] tracking-[0.3em] text-accent-red mb-1">QUAESTRON</div>
                <h1 className="font-serif text-5xl md:text-7xl leading-none tracking-tight text-foreground">
                  Intel
                </h1>
                <p className="font-serif italic text-base md:text-lg text-muted-foreground mt-3">
                  Threat intelligence, straight from the source. Every headline links to the document that reported it.
                </p>
              </div>
              <div className="font-mono text-[12px] text-muted md:text-right leading-relaxed">
                <div className="text-muted-foreground">{formatDateline(now)}</div>
                <div>
                  {loading ? 'Loading edition…' : `${items.length} stories · ${sourceCounts.length} sources`}
                  {fetchedAt && !loading && ` · updated ${timeAgo(fetchedAt, now)}`}
                </div>
                <button
                  onClick={() => fetchFeeds(true)}
                  disabled={refreshing || loading}
                  className="mt-1 text-muted hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {refreshing ? 'Refreshing…' : '↻ Refresh'}
                </button>
              </div>
            </div>
          </header>

          {/* Section nav + search */}
          <nav
            aria-label="Sections"
            className="sticky top-12 z-30 bg-background/95 backdrop-blur-md border-b border-border -mx-4 px-4 md:-mx-8 md:px-8"
          >
            <div className="flex flex-col md:flex-row md:items-center gap-2 py-2">
              <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1">
                <button
                  onClick={clearFilters}
                  className={`shrink-0 px-2.5 py-1.5 font-mono text-[12px] tracking-wider rounded transition-colors ${
                    !filtering ? 'text-foreground bg-surface-hover' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  FRONT PAGE
                </button>
                {CATEGORY_ORDER.filter((cat) => (categoryCounts.get(cat) || 0) > 0).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(category === cat ? null : cat)}
                    className={`shrink-0 px-2.5 py-1.5 font-mono text-[12px] tracking-wider rounded transition-colors uppercase ${
                      category === cat ? 'bg-surface-hover' : 'text-muted-foreground hover:text-foreground'
                    }`}
                    style={category === cat ? { color: categoryColor(cat) } : undefined}
                  >
                    {categoryShort(cat)}
                  </button>
                ))}
              </div>
              <div className="md:ml-auto flex items-center gap-2">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search headlines, sources, CVEs"
                  aria-label="Search stories"
                  className="w-full md:w-64 px-3 py-1.5 bg-surface border border-border rounded font-mono text-[12px] text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50"
                />
              </div>
            </div>
          </nav>

          {/* Body */}
          {loading ? (
            <div className="py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 animate-pulse">
              <div className="lg:col-span-8 space-y-4">
                <div className="h-3 w-24 bg-surface rounded" />
                <div className="h-10 w-5/6 bg-surface rounded" />
                <div className="h-10 w-2/3 bg-surface rounded" />
                <div className="h-4 w-full bg-surface rounded mt-6" />
                <div className="h-4 w-4/5 bg-surface rounded" />
                <div className="grid sm:grid-cols-2 gap-8 pt-8">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-3">
                      <div className="h-3 w-16 bg-surface rounded" />
                      <div className="h-6 w-full bg-surface rounded" />
                      <div className="h-6 w-3/4 bg-surface rounded" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="lg:col-span-4 space-y-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-5 bg-surface rounded" />
                ))}
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="py-24 text-center">
              <div className="font-serif text-2xl text-foreground mb-2">No edition available</div>
              <p className="text-sm text-muted-foreground">
                {failed ? 'The feeds could not be fetched. Check the network and try refreshing.' : 'No stories were returned by any source.'}
              </p>
            </div>
          ) : filtering ? (
            <section className="py-8">
              <SectionRule title={editionTitle} action="Back to front page" onAction={clearFilters} />
              <div className="font-mono text-[12px] text-muted mb-2">
                {filtered.length} {filtered.length === 1 ? 'story' : 'stories'}
              </div>
              {filtered.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Nothing matches. Try another term or section.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {filtered.map((item) => (
                    <ListStory key={item.link + item.source} item={item} now={now} />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <>
              {/* Above the fold: lead + top stories, Latest column */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 py-8 md:py-10">
                <div className="lg:col-span-8">
                  {frontPage.lead && (
                    <LeadStory item={frontPage.lead} now={now} developing={priorityScore(frontPage.lead, now) > 0} />
                  )}
                  {frontPage.top.length > 0 && (
                    <div className="grid sm:grid-cols-2 gap-x-8 gap-y-8 mt-8 pt-8 border-t border-border">
                      {frontPage.top.map((item) => (
                        <StoryCard key={item.link + item.source} item={item} now={now} />
                      ))}
                    </div>
                  )}
                </div>
                <aside className="lg:col-span-4 lg:border-l lg:border-border lg:pl-8">
                  <div className="flex items-baseline justify-between border-t-2 border-foreground/70 pt-3 mb-4">
                    <h2 className="font-serif text-xl text-foreground">Latest</h2>
                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent-green" />
                      </span>
                      LIVE
                    </span>
                  </div>
                  <ol className="divide-y divide-border/60">
                    {latest.map((item) => (
                      <LatestRow key={item.link + item.source} item={item} now={now} />
                    ))}
                  </ol>
                </aside>
              </div>

              {/* One section per category */}
              {sections.map(([cat, list]) => (
                <section key={cat} className="py-6 md:py-8">
                  <SectionRule
                    title={categoryLabel(cat)}
                    action={`All ${categoryCounts.get(cat) || list.length}`}
                    onAction={() => setCategory(cat)}
                  />
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-6">
                    {list.slice(0, SECTION_PREVIEW).map((item) => (
                      <CompactStory key={item.link + item.source} item={item} now={now} />
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}

          {/* Sources index */}
          {!loading && items.length > 0 && (
            <footer className="py-8 md:py-10 border-t-2 border-foreground/70 mt-4">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-serif text-xl text-foreground">Sources</h2>
                <span className="font-mono text-[12px] text-muted">
                  {sourceCounts.length} outlets, advisories and labs · refreshed every 5 minutes
                </span>
              </div>
              <ul className="columns-2 sm:columns-3 md:columns-4 gap-x-8">
                {sourceCounts.map(([source, count]) => (
                  <li key={source} className="break-inside-avoid">
                    <button
                      onClick={() => {
                        setCategory(null)
                        setQuery(source)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      className="w-full flex items-baseline justify-between gap-2 py-1 text-left font-mono text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span className="truncate">{source}</span>
                      <span className="text-muted tabular-nums">{count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </footer>
          )}
        </div>
      </main>

      <BottomBar lastUpdated={fetchedAt ? timeAgo(fetchedAt, now) : undefined} />
    </div>
  )
}
