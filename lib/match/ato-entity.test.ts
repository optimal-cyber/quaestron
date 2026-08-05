import { describe, it, expect } from 'vitest'
import { matchAtoName, AUTO_MATCH_MIN, type MatcherIndex } from './ato-entity'
import { normalizeVendorName } from './vendor-name'

/**
 * Matcher regression suite.
 *
 * Every case in the "must not" block corresponds to a false positive the first
 * implementation actually produced against the real entity set. They are the
 * reason this file exists: a wrong link attributes another company's contracts
 * and risk flags to a vendor, on a page an acquisition officer may act on.
 *
 * The index is hand-built rather than loaded from the database so the suite
 * pins behaviour to a fixed fixture — a matcher change that breaks these is a
 * real regression, not a data drift.
 */

interface Fixture {
  id: string
  name: string
  slug: string
  type: string
  aka?: string[]
}

/** Mirrors the shape and hazards of the production entity set. */
const FIXTURES: Fixture[] = [
  // The trap: investor arms exist, the bare companies do not.
  { id: 'e1', name: 'Amazon Alexa Fund', slug: 'amazon-alexa-fund', type: 'INVESTOR' },
  { id: 'e2', name: 'Salesforce Ventures', slug: 'salesforce-ventures', type: 'INVESTOR' },
  { id: 'e3', name: 'SAIC Capital', slug: 'saic-capital', type: 'INVESTOR' },
  { id: 'e4', name: 'Mosaic Ventures', slug: 'mosaic-ventures', type: 'INVESTOR' },
  { id: 'e5', name: 'Microsoft ScaleUp', slug: 'microsoft-scaleup', type: 'INVESTOR' },
  // The other trap: alsoKnownAs holds the PARENT company, not an alias.
  { id: 'e6', name: 'Ring', slug: 'ring', type: 'SURVEILLANCE', aka: ['Amazon'] },
  { id: 'e7', name: 'Data Grand', slug: 'data-grand', type: 'AI_ML', aka: ['Microsoft'] },
  // Legitimate vendors.
  { id: 'e8', name: 'Palantir', slug: 'palantir', type: 'AI_ML' },
  { id: 'e9', name: 'Google LLC', slug: 'google-llc', type: 'CLOUD_INFRA' },
  { id: 'e10', name: 'Second Front Systems', slug: 'second-front-systems', type: 'CLOUD_INFRA' },
  { id: 'e11', name: 'Oracle', slug: 'oracle', type: 'CLOUD_INFRA' },
  { id: 'e12', name: 'Department of Defense', slug: 'department-of-defense', type: 'GOVERNMENT' },
]

function buildFixtureIndex(): MatcherIndex {
  const entities = FIXTURES.map((f) => {
    const normalized = normalizeVendorName(f.name)
    return {
      id: f.id,
      name: f.name,
      slug: f.slug,
      type: f.type,
      normalized,
      tokens: new Set(normalized.split(' ').filter(Boolean)),
      akaNormalized: (f.aka ?? []).map((a) => normalizeVendorName(a)).filter(Boolean),
    }
  })

  const byNormalized = new Map<string, (typeof entities)[number]>()
  const bySlug = new Map<string, (typeof entities)[number]>()
  const byAka = new Map<string, (typeof entities)[number]>()
  for (const e of entities) {
    if (e.normalized && !byNormalized.has(e.normalized)) byNormalized.set(e.normalized, e)
    if (!bySlug.has(e.slug)) bySlug.set(e.slug, e)
    for (const aka of e.akaNormalized) if (!byAka.has(aka)) byAka.set(aka, e)
  }
  return { entities, byNormalized, bySlug, byAka }
}

const index = buildFixtureIndex()

describe('matchAtoName — must not link a CSP to an investor arm', () => {
  // A short feed name must never be expanded into a longer, different org.
  it.each([
    ['Salesforce', 'Salesforce Ventures'],
    ['SAIC', 'SAIC Capital'],
    ['Mosaic', 'Mosaic Ventures'],
    ['Amazon', 'Amazon Alexa Fund'],
    ['Microsoft', 'Microsoft ScaleUp'],
  ])('"%s" does not auto-link to "%s"', (probe, forbidden) => {
    expect(matchAtoName(index, probe).match?.name).not.toBe(forbidden)
  })

  it('excludes INVESTOR entities from fuzzy matching entirely', () => {
    const result = matchAtoName(index, 'Salesforce Government Cloud')
    expect(result.match).toBeNull()
  })

  it('excludes GOVERNMENT entities from fuzzy matching', () => {
    // "Department of Defense Cloud One" must not fuzzy-match the agency itself.
    const result = matchAtoName(index, 'Department of Defense Cloud One')
    expect(result.match).toBeNull()
  })
})

describe('matchAtoName — alsoKnownAs holds parent companies, not aliases', () => {
  it.each([
    ['Amazon', 'Ring'],
    ['Microsoft', 'Data Grand'],
  ])('"%s" does not auto-link to subsidiary "%s"', (probe, subsidiary) => {
    const result = matchAtoName(index, probe)
    expect(result.match).toBeNull()
    // Still surfaced for a human to resolve in the review queue.
    expect(result.suggestions.some((s) => s.name === subsidiary)).toBe(true)
  })

  it('scores an alsoKnownAs hit below the auto-match threshold', () => {
    const result = matchAtoName(index, 'Amazon')
    const aka = result.suggestions.find((s) => s.method === 'also-known-as')
    expect(aka).toBeDefined()
    expect(aka!.score).toBeLessThan(AUTO_MATCH_MIN)
  })
})

describe('matchAtoName — legitimate matches still resolve', () => {
  it('matches an exact normalized name', () => {
    const result = matchAtoName(index, 'Palantir')
    expect(result.match?.name).toBe('Palantir')
    expect(result.match?.method).toBe('exact-normalized')
  })

  it('collapses corporate suffixes when normalizing', () => {
    // "Google" and "Google LLC" both normalize to "google".
    expect(matchAtoName(index, 'Google').match?.name).toBe('Google LLC')
  })

  it('accepts a MORE specific feed name than the entity name', () => {
    const result = matchAtoName(index, 'Palantir Gotham Federal Cloud')
    expect(result.match?.name).toBe('Palantir')
    expect(result.match?.method).toBe('token-prefix')
    expect(result.match!.score).toBeGreaterThanOrEqual(AUTO_MATCH_MIN)
  })

  it('matches multi-word vendors exactly', () => {
    expect(matchAtoName(index, 'Second Front Systems').match?.name).toBe('Second Front Systems')
  })
})

describe('matchAtoName — refuses rather than guesses', () => {
  it.each(['', '   ', 'Acme Nonexistent Cloud LLC', 'AI', 'US'])(
    'returns no match for %j',
    (probe) => {
      expect(matchAtoName(index, probe).match).toBeNull()
    }
  )

  it('never returns a match below the auto-match threshold', () => {
    for (const probe of ['Amazon', 'Microsoft', 'Salesforce', 'Palantir', 'Google']) {
      const { match } = matchAtoName(index, probe)
      if (match) expect(match.score).toBeGreaterThanOrEqual(AUTO_MATCH_MIN)
    }
  })

  it('caps suggestions at three so the review queue stays readable', () => {
    for (const probe of ['Amazon', 'Cloud', 'Systems']) {
      expect(matchAtoName(index, probe).suggestions.length).toBeLessThanOrEqual(3)
    }
  })
})
