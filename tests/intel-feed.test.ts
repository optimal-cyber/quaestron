import { describe, expect, it } from 'vitest'
import {
  groupByCategory,
  matchesQuery,
  priorityScore,
  rankFrontPage,
  timeAgo,
  type FeedItem,
} from '@/app/intel/feed'

const NOW = new Date('2026-09-21T12:00:00Z')

function item(overrides: Partial<FeedItem> & { title: string }): FeedItem {
  return {
    link: 'https://example.com/' + overrides.title.replace(/\W+/g, '-'),
    pubDate: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    source: 'Example',
    category: 'CYBER',
    description: '',
    ...overrides,
  }
}

describe('priorityScore', () => {
  it('ranks an exploited zero-day above a routine post', () => {
    const zeroDay = item({ title: 'Zero-day in Widget actively exploited', category: 'THREAT_INTEL' })
    const routine = item({ title: 'Weekly roundup of security news' })
    expect(priorityScore(zeroDay, NOW)).toBeGreaterThan(priorityScore(routine, NOW))
    expect(priorityScore(routine, NOW)).toBe(0)
  })

  it('decays with age and drops to zero after three days', () => {
    const fresh = item({ title: 'Critical flaw', pubDate: new Date(NOW.getTime() - 3_600_000).toISOString() })
    const stale = item({ title: 'Critical flaw', pubDate: new Date(NOW.getTime() - 48 * 3_600_000).toISOString() })
    const dead = item({ title: 'Critical flaw', pubDate: new Date(NOW.getTime() - 96 * 3_600_000).toISOString() })
    expect(priorityScore(fresh, NOW)).toBeGreaterThan(priorityScore(stale, NOW))
    expect(priorityScore(stale, NOW)).toBeGreaterThan(0)
    expect(priorityScore(dead, NOW)).toBe(0)
  })

  it('scores zero for an unparseable date', () => {
    expect(priorityScore(item({ title: 'Critical flaw', pubDate: 'not a date' }), NOW)).toBe(0)
  })
})

describe('rankFrontPage', () => {
  it('puts the highest-scoring item in the lead and excludes featured items from rest', () => {
    const items = [
      item({ title: 'Quiet post A' }),
      item({ title: 'Ransomware gang hits hospital' }),
      item({ title: 'Emergency directive: zero-day actively exploited', category: 'THREAT_INTEL' }),
      item({ title: 'Quiet post B' }),
      item({ title: 'Quiet post C' }),
      item({ title: 'Quiet post D' }),
      item({ title: 'Quiet post E' }),
    ]
    const { lead, top, rest } = rankFrontPage(items, 2, NOW)
    expect(lead?.title).toBe('Emergency directive: zero-day actively exploited')
    expect(top[0].title).toBe('Ransomware gang hits hospital')
    expect(top).toHaveLength(2)
    expect(rest).toHaveLength(4)
    expect(rest.map((i) => i.title)).not.toContain(lead?.title)
  })

  it('falls back to feed order when nothing scores', () => {
    const items = [item({ title: 'First' }), item({ title: 'Second' }), item({ title: 'Third' })]
    const { lead, top, rest } = rankFrontPage(items, 1, NOW)
    expect(lead?.title).toBe('First')
    expect(top.map((i) => i.title)).toEqual(['Second'])
    expect(rest.map((i) => i.title)).toEqual(['Third'])
  })

  it('handles an empty feed', () => {
    expect(rankFrontPage([], 4, NOW)).toEqual({ lead: null, top: [], rest: [] })
  })
})

describe('groupByCategory', () => {
  it('orders known categories by CATEGORY_ORDER and drops empties', () => {
    const items = [
      item({ title: 'a', category: 'OSINT' }),
      item({ title: 'b', category: 'THREAT_INTEL' }),
      item({ title: 'c', category: 'OSINT' }),
      item({ title: 'd', category: 'MYSTERY' }),
    ]
    const groups = groupByCategory(items)
    expect(groups.map(([cat]) => cat)).toEqual(['THREAT_INTEL', 'OSINT', 'MYSTERY'])
    expect(groups[1][1]).toHaveLength(2)
  })
})

describe('matchesQuery', () => {
  it('matches title, source and description case-insensitively', () => {
    const it1 = item({ title: 'CVE-2026-1234 in Router', source: 'CISA KEV', description: 'Auth bypass' })
    expect(matchesQuery(it1, 'cve-2026')).toBe(true)
    expect(matchesQuery(it1, 'cisa')).toBe(true)
    expect(matchesQuery(it1, 'BYPASS')).toBe(true)
    expect(matchesQuery(it1, 'printer')).toBe(false)
    expect(matchesQuery(it1, '   ')).toBe(true)
  })
})

describe('timeAgo', () => {
  it('renders relative times', () => {
    expect(timeAgo(new Date(NOW.getTime() - 30_000).toISOString(), NOW)).toBe('just now')
    expect(timeAgo(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe('5m ago')
    expect(timeAgo(new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), NOW)).toBe('3h ago')
    expect(timeAgo(new Date(NOW.getTime() - 2 * 86_400_000).toISOString(), NOW)).toBe('2d ago')
    expect(timeAgo('garbage', NOW)).toBe('')
  })
})
