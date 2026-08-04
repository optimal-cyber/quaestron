import { prisma } from '@/lib/db'
import { cleanAgency, daysUntil, isAuthorized, levelRank, safeJsonArray } from './shared'

/**
 * The authorized-cloud universe as one filterable table.
 *
 * FedRAMP authorizations and DoD provisional authorizations live in separate
 * tables with different column names and different impact-level vocabularies,
 * so they're normalized into a common row shape here and merged.
 *
 * TRADEOFF — merge-then-paginate: filters that map to real columns run in SQL,
 * but the union, sort, and page slice happen in memory. At current volume (~650
 * FedRAMP + a small DoD PA set) that is well under a millisecond and keeps the
 * two vocabularies honest. It will not hold if the universe reaches tens of
 * thousands of rows; at that point this wants a materialized view or a
 * denormalized `ComplianceRow` table refreshed by the daily cron.
 *
 * TRADEOFF — set-aside filtering: `Entity.setAsides` is a JSON-encoded array in
 * a TEXT column, so filtering is a substring match on the serialized form. The
 * values are enum-like tokens (`SDVOSB`, `HUBZONE`) quoted in the JSON, so
 * matching `"SDVOSB"` including the quotes is exact in practice. A join table
 * would be the correct fix and is deferred to the Phase 5 tech-debt pass.
 */

export interface ComplianceRow {
  key: string
  source: 'fedramp' | 'dod-pa'
  /** FedRAMP package ID; null for DoD PAs, which have no public package ID. */
  packageId: string | null
  vendor: string
  offering: string
  impactLevel: string | null
  status: string
  authorizationDate: string | null
  expirationDate: string | null
  daysRemaining: number | null
  sponsoringAgency: string | null
  leveragingAgencies: string[]
  leveragingCount: number
  /** FedRAMP's own small-business flag; null for DoD PA rows, which lack one. */
  smallBusiness: boolean | null
  entity: {
    id: string
    name: string
    slug: string
    businessSize: string | null
    setAsides: string[]
    riskFlags: string[]
    totalFederalObligated: number | null
  } | null
}

export interface UniverseFilters {
  search?: string
  /** Accepts both vocabularies: Low/Moderate/High and IL2–IL6. */
  impactLevel?: string
  status?: string
  agency?: string
  businessSize?: string
  setAside?: string
  /** Only rows expiring within this many days. */
  expiringWithinDays?: number
  source?: 'fedramp' | 'dod-pa'
  sort?: 'expiration' | 'obligated' | 'vendor' | 'level'
  page?: number
  limit?: number
}

export interface UniverseResult {
  rows: ComplianceRow[]
  total: number
  page: number
  limit: number
  /** True when the pre-merge cap was hit and results may be incomplete. */
  truncated: boolean
}

/** Guard against an unbounded in-memory merge; surfaced as `truncated`. */
const MAX_SCAN = 5000

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

export async function queryUniverse(filters: UniverseFilters): Promise<UniverseResult> {
  const now = new Date()
  const page = Math.max(1, filters.page ?? 1)
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50))

  const expiryCutoff =
    filters.expiringWithinDays !== undefined
      ? new Date(now.getTime() + filters.expiringWithinDays * 24 * 60 * 60 * 1000)
      : null

  // Entity-side predicates apply through the relation, so a row whose entity is
  // unresolved is correctly excluded when the user filters on business size or
  // set-aside — we can't claim a vendor is SDVOSB if we don't know who it is.
  const entityFilter: Record<string, unknown> = {}
  // Set-asides only exist on the enriched Entity, so that filter necessarily
  // implies a resolved entity. Business size does not: FedRAMP publishes its own
  // flag, handled per-source below.
  if (filters.setAside) entityFilter.setAsides = { contains: `"${filters.setAside}"` }
  if (filters.businessSize && filters.businessSize !== 'SMALL') {
    entityFilter.businessSize = filters.businessSize
  }
  const hasEntityFilter = Object.keys(entityFilter).length > 0

  const entitySelect = {
    select: {
      id: true,
      name: true,
      slug: true,
      businessSize: true,
      setAsides: true,
      riskFlags: true,
      totalFederalObligated: true,
    },
  } as const

  const wantFedramp = !filters.source || filters.source === 'fedramp'
  const wantDod = !filters.source || filters.source === 'dod-pa'

  // A FedRAMP-only vocabulary term can't match a DoD PA row and vice versa, so
  // an impact filter implicitly narrows the sources queried.
  const impactIsDod = filters.impactLevel?.startsWith('IL') ?? false
  const impactIsFedramp = Boolean(filters.impactLevel) && !impactIsDod

  const [fedrampRows, dodRows] = await Promise.all([
    wantFedramp && !impactIsDod
      ? prisma.fedrampAuthorization.findMany({
          where: {
            // Search and the small-business filter each need their own OR, so
            // they go under AND — two `OR` keys on one object would silently
            // clobber each other and drop the search term.
            AND: [
              ...(filters.search
                ? [
                    {
                      OR: [
                        { csoName: { contains: filters.search } },
                        { cspName: { contains: filters.search } },
                      ],
                    },
                  ]
                : []),
              ...(filters.businessSize === 'SMALL'
                ? [{ OR: [{ smallBusiness: true }, { entity: { businessSize: 'SMALL' } }] }]
                : []),
            ],
            ...(filters.impactLevel ? { impactLevel: filters.impactLevel } : {}),
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.agency ? { sponsoringAgency: { contains: filters.agency } } : {}),
            ...(expiryCutoff ? { expirationDate: { gte: now, lte: expiryCutoff } } : {}),
            ...(hasEntityFilter ? { entity: entityFilter } : {}),
          },
          include: { entity: entitySelect },
          take: MAX_SCAN,
        })
      : Promise.resolve([]),
    wantDod && !impactIsFedramp
      ? prisma.dodProvisionalAuth.findMany({
          where: {
            ...(filters.search
              ? {
                  OR: [
                    { csoName: { contains: filters.search } },
                    { cspName: { contains: filters.search } },
                  ],
                }
              : {}),
            ...(filters.impactLevel ? { impactLevel: filters.impactLevel } : {}),
            ...(filters.agency ? { sponsorComponent: { contains: filters.agency } } : {}),
            ...(expiryCutoff ? { paExpiration: { gte: now, lte: expiryCutoff } } : {}),
            // DoD PA rows carry no feed-level small-business flag, so SMALL
            // here can only mean the resolved entity says so.
            ...(hasEntityFilter || filters.businessSize === 'SMALL'
              ? {
                  entity: {
                    ...entityFilter,
                    ...(filters.businessSize === 'SMALL' ? { businessSize: 'SMALL' } : {}),
                  },
                }
              : {}),
          },
          include: { entity: entitySelect },
          take: MAX_SCAN,
        })
      : Promise.resolve([]),
  ])

  const mapEntity = (e: {
    id: string
    name: string
    slug: string
    businessSize: string | null
    setAsides: string
    riskFlags: string
    totalFederalObligated: number | null
  } | null) =>
    e
      ? {
          id: e.id,
          name: e.name,
          slug: e.slug,
          businessSize: e.businessSize,
          setAsides: safeJsonArray(e.setAsides),
          riskFlags: safeJsonArray(e.riskFlags),
          totalFederalObligated: e.totalFederalObligated,
        }
      : null

  const rows: ComplianceRow[] = [
    ...fedrampRows.map((r): ComplianceRow => {
      const leveraging = safeJsonArray(r.leveragingAgencies)
      return {
        key: `fedramp:${r.packageId}`,
        source: 'fedramp',
        packageId: r.packageId,
        vendor: r.entity?.name ?? r.cspName,
        offering: r.csoName,
        impactLevel: r.impactLevel,
        status: r.status,
        authorizationDate: iso(r.authorizationDate),
        expirationDate: iso(r.expirationDate),
        daysRemaining: daysUntil(r.expirationDate, now),
        sponsoringAgency: cleanAgency(r.sponsoringAgency),
        leveragingAgencies: leveraging.slice(0, 8),
        leveragingCount: leveraging.length,
        smallBusiness: r.smallBusiness,
        entity: mapEntity(r.entity),
      }
    }),
    ...dodRows.map((r): ComplianceRow => ({
      key: `dod-pa:${r.id}`,
      source: 'dod-pa',
      packageId: null,
      vendor: r.entity?.name ?? r.cspName,
      offering: r.csoName,
      impactLevel: r.impactLevel,
      // DoD PA rows carry no status column; presence of a PA is the status.
      status: 'Authorized',
      authorizationDate: iso(r.paDate),
      expirationDate: iso(r.paExpiration),
      daysRemaining: daysUntil(r.paExpiration, now),
      sponsoringAgency: cleanAgency(r.sponsorComponent),
      leveragingAgencies: [],
      leveragingCount: 0,
      smallBusiness: r.entity?.businessSize === 'SMALL' ? true : null,
      entity: mapEntity(r.entity),
    })),
  ]

  const sort = filters.sort ?? 'expiration'
  rows.sort((a, b) => {
    switch (sort) {
      case 'vendor':
        return a.vendor.localeCompare(b.vendor)
      case 'level':
        return levelRank(b.impactLevel) - levelRank(a.impactLevel)
      case 'obligated':
        return (b.entity?.totalFederalObligated ?? 0) - (a.entity?.totalFederalObligated ?? 0)
      case 'expiration':
      default: {
        // Rows without an expiration sort last rather than pretending to be urgent.
        const ad = a.daysRemaining ?? Number.POSITIVE_INFINITY
        const bd = b.daysRemaining ?? Number.POSITIVE_INFINITY
        return ad - bd
      }
    }
  })

  const start = (page - 1) * limit
  return {
    rows: rows.slice(start, start + limit),
    total: rows.length,
    page,
    limit,
    truncated: fedrampRows.length >= MAX_SCAN || dodRows.length >= MAX_SCAN,
  }
}

/** Distinct filter values, so the UI offers only options that return results. */
export async function universeFacets() {
  const [fedramp, dod] = await Promise.all([
    prisma.fedrampAuthorization.findMany({
      select: { impactLevel: true, status: true, sponsoringAgency: true },
      take: MAX_SCAN,
    }),
    prisma.dodProvisionalAuth.findMany({
      select: { impactLevel: true, sponsorComponent: true },
      take: MAX_SCAN,
    }),
  ])

  const levels = new Set<string>()
  const statuses = new Set<string>()
  const agencies = new Set<string>()

  for (const r of fedramp) {
    if (r.impactLevel) levels.add(r.impactLevel)
    if (r.status) statuses.add(r.status)
    const agency = cleanAgency(r.sponsoringAgency)
    if (agency) agencies.add(agency)
  }
  for (const r of dod) {
    if (r.impactLevel) levels.add(r.impactLevel)
    const agency = cleanAgency(r.sponsorComponent)
    if (agency) agencies.add(agency)
  }

  return {
    impactLevels: [...levels].sort((a, b) => levelRank(a) - levelRank(b)),
    statuses: [...statuses].sort(),
    agencies: [...agencies].sort().slice(0, 300),
  }
}

/** Count of live authorizations — used by the header stat strip. */
export async function universeTotals() {
  const [fedrampAll, dodCount, emassCount] = await Promise.all([
    prisma.fedrampAuthorization.findMany({ select: { status: true }, take: MAX_SCAN }),
    prisma.dodProvisionalAuth.count(),
    prisma.emassAuthorization.count(),
  ])

  return {
    fedrampTotal: fedrampAll.length,
    fedrampAuthorized: fedrampAll.filter((r) => isAuthorized(r.status)).length,
    dodPaTotal: dodCount,
    emassTotal: emassCount,
  }
}
