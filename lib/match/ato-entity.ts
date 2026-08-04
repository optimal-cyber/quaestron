import { prisma } from '@/lib/db'
import { findAlias } from './aliases'
import { normalizeVendorName, slugify } from './vendor-name'

/**
 * Resolves ATO-feed vendor names (FedRAMP `cspName`, DoD PA `cspName`, eMASS
 * `cloudProvider`) to tracked `Entity` rows.
 *
 * The whole index is loaded once and matched in memory: a per-row DB lookup
 * across three tables would be thousands of round trips, and several strategies
 * (token overlap) can't be expressed as a SQL predicate anyway.
 *
 * Scoring is deliberately conservative. A wrong link is worse than no link —
 * it would attribute another company's contracts and risk flags to a vendor on
 * a page an acquisition officer might act on. Anything below AUTO_MATCH_MIN is
 * routed to the review queue instead of guessed at.
 */

export const AUTO_MATCH_MIN = 0.8

export type MatchMethod =
  | 'exact-normalized'
  | 'alias'
  | 'also-known-as'
  | 'slug'
  | 'token-prefix'
  | 'token-overlap'

export interface MatchCandidate {
  entityId: string
  name: string
  slug: string
  score: number
  method: MatchMethod
}

export interface MatchResult {
  /** Set only when the best candidate clears AUTO_MATCH_MIN. */
  match: MatchCandidate | null
  /** Top near-misses, best first — what the admin review queue shows. */
  suggestions: MatchCandidate[]
}

interface IndexedEntity {
  id: string
  name: string
  slug: string
  type: string
  normalized: string
  tokens: Set<string>
  akaNormalized: string[]
}

/**
 * A cloud service provider is never a venture fund or a federal agency.
 * Excluding these from fuzzy strategies kills an entire false-positive class:
 * the entity set contains "Amazon Alexa Fund", "Salesforce Ventures",
 * "SAIC Capital" and friends, but no bare "Amazon" / "Salesforce" / "SAIC", so
 * an unconstrained prefix match happily attributes AWS's authorizations to
 * Amazon's venture arm.
 */
const FUZZY_EXCLUDED_TYPES = new Set(['INVESTOR', 'GOVERNMENT'])

export interface MatcherIndex {
  entities: IndexedEntity[]
  byNormalized: Map<string, IndexedEntity>
  bySlug: Map<string, IndexedEntity>
  byAka: Map<string, IndexedEntity>
}

/**
 * Single-token names ("Google", "Oracle") are matched only by exact/alias/slug.
 * Fuzzy strategies on one short token produce false positives — the SAIC vs
 * Mosaic class of bug — and a wrong crosswalk link is the expensive failure.
 */
const MIN_FUZZY_TOKEN_LENGTH = 4

function tokenize(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter(Boolean))
}

function safeJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export async function buildMatcherIndex(): Promise<MatcherIndex> {
  const rows = await prisma.entity.findMany({
    select: { id: true, name: true, slug: true, type: true, alsoKnownAs: true },
  })

  const entities: IndexedEntity[] = rows.map((row) => {
    const normalized = normalizeVendorName(row.name)
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      type: row.type,
      normalized,
      tokens: tokenize(normalized),
      akaNormalized: safeJsonArray(row.alsoKnownAs)
        .map((aka) => normalizeVendorName(aka))
        .filter(Boolean),
    }
  })

  const byNormalized = new Map<string, IndexedEntity>()
  const bySlug = new Map<string, IndexedEntity>()
  const byAka = new Map<string, IndexedEntity>()

  for (const entity of entities) {
    // First writer wins so a later near-duplicate can't shadow the canonical row.
    if (entity.normalized && !byNormalized.has(entity.normalized)) {
      byNormalized.set(entity.normalized, entity)
    }
    if (!bySlug.has(entity.slug)) bySlug.set(entity.slug, entity)
    for (const aka of entity.akaNormalized) {
      if (!byAka.has(aka)) byAka.set(aka, entity)
    }
  }

  return { entities, byNormalized, bySlug, byAka }
}

function candidate(entity: IndexedEntity, score: number, method: MatchMethod): MatchCandidate {
  return { entityId: entity.id, name: entity.name, slug: entity.slug, score, method }
}

/** Jaccard similarity over normalized tokens. */
function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  const union = a.size + b.size - shared
  return union === 0 ? 0 : shared / union
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  return shared
}

export function matchAtoName(index: MatcherIndex, rawName: string): MatchResult {
  const empty: MatchResult = { match: null, suggestions: [] }
  if (!rawName?.trim()) return empty

  const normalized = normalizeVendorName(rawName)
  if (!normalized) return empty

  const found: MatchCandidate[] = []

  // 1. Exact normalized name.
  const exact = index.byNormalized.get(normalized)
  if (exact) found.push(candidate(exact, 1, 'exact-normalized'))

  // 2. Curated alias registry — resolves trade name vs legal name.
  const alias = findAlias(rawName)
  if (alias) {
    const viaAlias = index.byNormalized.get(normalizeVendorName(alias.canonical))
    if (viaAlias) found.push(candidate(viaAlias, 0.95, 'alias'))
  }

  // 3. Entity.alsoKnownAs — suggestion strength only, deliberately below
  // AUTO_MATCH_MIN. In this dataset the field holds the PARENT company rather
  // than a true alias (Ring's aka is ["Amazon"], Data Grand's is ["Microsoft"]),
  // so a reverse lookup inverts the relationship and links the feed's CSP to a
  // subsidiary. An operator resolves these from the review queue instead.
  const viaAka = index.byAka.get(normalized)
  if (viaAka) found.push(candidate(viaAka, 0.7, 'also-known-as'))

  // 4. Slug equality.
  const viaSlug = index.bySlug.get(slugify(rawName))
  if (viaSlug) found.push(candidate(viaSlug, 0.9, 'slug'))

  const tokens = tokenize(normalized)
  const longEnoughForFuzzy =
    tokens.size > 1 || normalized.length >= MIN_FUZZY_TOKEN_LENGTH

  if (longEnoughForFuzzy) {
    for (const entity of index.entities) {
      if (!entity.normalized) continue
      if (FUZZY_EXCLUDED_TYPES.has(entity.type)) continue

      // 5. Token-prefix containment, in ONE direction only: the feed name may be
      // more specific than the entity ("palantir gotham federal" → "Palantir"),
      // because a CSO name routinely carries product and edition suffixes.
      //
      // The reverse is not a match. Expanding a short feed name into a longer
      // entity name picks a *different, more specific* organization —
      // "Salesforce" → "Salesforce Ventures". The trailing space also keeps the
      // boundary honest so "mosaic" never swallows "saic".
      if (normalized.startsWith(entity.normalized + ' ')) {
        if (entity.normalized.length >= MIN_FUZZY_TOKEN_LENGTH) {
          found.push(candidate(entity, 0.85, 'token-prefix'))
          continue
        }
      }

      // 6. Token overlap — suggestion territory, never an auto-match. Requires
      // at least two shared tokens so a single common word can't carry it.
      if (tokens.size > 1 && entity.tokens.size > 1) {
        if (sharedTokenCount(tokens, entity.tokens) >= 2) {
          const similarity = jaccard(tokens, entity.tokens)
          if (similarity >= 0.5) {
            found.push(candidate(entity, Math.min(0.79, similarity), 'token-overlap'))
          }
        }
      }
    }
  }

  if (found.length === 0) return empty

  // Best score per entity, then best overall.
  const bestPerEntity = new Map<string, MatchCandidate>()
  for (const c of found) {
    const existing = bestPerEntity.get(c.entityId)
    if (!existing || c.score > existing.score) bestPerEntity.set(c.entityId, c)
  }

  const ranked = [...bestPerEntity.values()].sort((a, b) => b.score - a.score)
  const best = ranked[0]

  // An auto-match must also be unambiguous: two entities tied at the top means
  // we genuinely don't know which one, so it goes to review.
  const ambiguous = ranked.length > 1 && ranked[1].score === best.score

  return {
    match: best.score >= AUTO_MATCH_MIN && !ambiguous ? best : null,
    suggestions: ranked.slice(0, 3),
  }
}

/** Convenience for one-off resolution; builds the whole index, so don't loop on it. */
export async function resolveAtoName(rawName: string): Promise<MatchResult> {
  const index = await buildMatcherIndex()
  return matchAtoName(index, rawName)
}
