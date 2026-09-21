/**
 * Shared shape and helpers for the /intel front page.
 *
 * The page is an editorial front page over the aggregated RSS feed rather than
 * a dashboard: one lead story, a handful of top stories, then a section per
 * category. Everything here is the pure part of that — typing the feed, the
 * category vocabulary, and the ranking that decides what leads.
 */

export interface FeedItem {
  title: string
  link: string
  pubDate: string
  source: string
  category: string
  description: string
}

export const CATEGORY_ORDER = [
  'THREAT_INTEL',
  'VULN',
  'CYBER',
  'DEFENSE',
  'POLICY',
  'AI_POLICY',
  'SURVEILLANCE',
  'OSINT',
] as const

export const CATEGORY_LABELS: Record<string, string> = {
  CYBER: 'Cybersecurity',
  THREAT_INTEL: 'Threat Intelligence',
  VULN: 'Vulnerabilities',
  DEFENSE: 'Defense',
  OSINT: 'OSINT',
  SURVEILLANCE: 'Surveillance & Privacy',
  POLICY: 'Policy',
  AI_POLICY: 'AI Governance',
}

/** Short form for kickers, chips and the section nav. */
export const CATEGORY_SHORT: Record<string, string> = {
  CYBER: 'Cyber',
  THREAT_INTEL: 'Threat Intel',
  VULN: 'Vulns',
  DEFENSE: 'Defense',
  OSINT: 'OSINT',
  SURVEILLANCE: 'Surveillance',
  POLICY: 'Policy',
  AI_POLICY: 'AI Governance',
}

export const CATEGORY_COLORS: Record<string, string> = {
  CYBER: '#C8102E',
  THREAT_INTEL: '#FF6B35',
  VULN: '#E74C3C',
  DEFENSE: '#4A7C9B',
  OSINT: '#2ECC71',
  SURVEILLANCE: '#B8953E',
  POLICY: '#8B5CF6',
  AI_POLICY: '#06B6D4',
}

export function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] || cat.replace(/_/g, ' ')
}

export function categoryShort(cat: string): string {
  return CATEGORY_SHORT[cat] || cat.replace(/_/g, ' ')
}

export function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] || '#64748B'
}

export function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const date = new Date(dateStr)
  return isNaN(date.getTime()) ? null : date
}

export function timeAgo(dateStr: string, now: Date = new Date()): string {
  const date = parseDate(dateStr)
  if (!date) return ''
  const diff = now.getTime() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "Monday, September 21, 2026" — the dateline under the masthead. */
export function formatDateline(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Terms that mark an item as worth the front page regardless of how many
 * quieter items were published after it. Weighted so that a confirmed
 * exploited zero-day outranks a generic ransomware round-up.
 */
const PRIORITY_TERMS: Array<[RegExp, number]> = [
  [/zero[- ]day|0[- ]day/i, 5],
  [/actively exploited|in the wild|known exploited/i, 5],
  [/emergency directive|emergency/i, 4],
  [/critical/i, 3],
  [/\bcve-\d{4}-\d+/i, 2],
  [/ransomware|extortion/i, 2],
  [/breach|leak(ed)?\b|exfiltrat/i, 2],
  [/apt\d+|nation[- ]state|state[- ]sponsored/i, 3],
  [/executive order|sanction|indict/i, 3],
  [/supply[- ]chain/i, 2],
  [/patch(ed|es)? (now|immediately)|urgent/i, 2],
]

const CATEGORY_WEIGHT: Record<string, number> = {
  THREAT_INTEL: 3,
  VULN: 2,
  CYBER: 1,
}

/**
 * How much an item deserves the front page. Keyword weight plus a small
 * category bias, decayed by age so yesterday's zero-day does not lead forever.
 * Items older than three days score zero and fall back to the timeline.
 */
export function priorityScore(item: FeedItem, now: Date = new Date()): number {
  const date = parseDate(item.pubDate)
  if (!date) return 0
  const ageHours = (now.getTime() - date.getTime()) / 3_600_000
  if (ageHours > 72 || ageHours < -6) return 0

  let score = 0
  for (const [re, weight] of PRIORITY_TERMS) {
    if (re.test(item.title)) score += weight
  }
  // The category bias only breaks ties between items that already qualified;
  // it never puts a routine post on the front page by itself.
  if (score === 0) return 0
  score += CATEGORY_WEIGHT[item.category] || 0

  // Linear decay to zero at 72h; something an hour old keeps almost all of it.
  return score * (1 - ageHours / 72)
}

/**
 * Split the feed into the front-page slots: one lead, `topCount` top stories,
 * and everything else. Priority items lead; if nothing scores, the newest
 * items do, so the front page never comes up empty on a quiet day.
 */
export function rankFrontPage(
  items: FeedItem[],
  topCount = 4,
  now: Date = new Date()
): { lead: FeedItem | null; top: FeedItem[]; rest: FeedItem[] } {
  if (items.length === 0) return { lead: null, top: [], rest: [] }

  const scored = items
    .map((item, index) => ({ item, index, score: priorityScore(item, now) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)

  const featured = scored.slice(0, topCount + 1).map((s) => s.item)
  const featuredSet = new Set(featured)
  return {
    lead: featured[0] ?? null,
    top: featured.slice(1),
    rest: items.filter((item) => !featuredSet.has(item)),
  }
}

/** Group items by category, preserving CATEGORY_ORDER, dropping empty groups. */
export function groupByCategory(items: FeedItem[]): Array<[string, FeedItem[]]> {
  const groups = new Map<string, FeedItem[]>()
  for (const item of items) {
    const list = groups.get(item.category)
    if (list) list.push(item)
    else groups.set(item.category, [item])
  }
  const ordered: Array<[string, FeedItem[]]> = []
  for (const cat of CATEGORY_ORDER) {
    const list = groups.get(cat)
    if (list && list.length) ordered.push([cat, list])
  }
  for (const [cat, list] of groups) {
    if (!(CATEGORY_ORDER as readonly string[]).includes(cat) && list.length) ordered.push([cat, list])
  }
  return ordered
}

export function matchesQuery(item: FeedItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    item.title.toLowerCase().includes(q) ||
    item.source.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q)
  )
}
