import { prisma } from '@/lib/db'
import { cleanAgency, daysUntil, isAuthorized, levelRank, safeJsonArray } from './shared'

/**
 * Derived compliance insights — the questions the crosswalk makes answerable
 * that neither FedRAMP Marketplace nor USASpending can answer alone.
 */

export interface ExpiringByAgency {
  agency: string
  expiringCount: number
  soonestDays: number | null
  sources: { fedramp: number; dodPa: number; emass: number }
}

export interface SmallBusinessAuthorization {
  entitySlug: string
  entityName: string
  offering: string
  impactLevel: string | null
  setAsides: string[]
  businessSize: string | null
  totalFederalObligated: number | null
  source: 'fedramp' | 'dod-pa'
}

export interface WhitespaceRow {
  entitySlug: string
  entityName: string
  offering: string
  impactLevel: string | null
  sponsoringAgency: string | null
  authorizationDate: string | null
  source: 'fedramp' | 'dod-pa'
}

export interface NewlyAuthorized {
  entitySlug: string | null
  vendor: string
  offering: string
  impactLevel: string | null
  authorizationDate: string | null
  sponsoringAgency: string | null
  source: 'fedramp' | 'dod-pa'
}

export interface ComplianceInsights {
  expiringByAgency: ExpiringByAgency[]
  smallBusinessAuthorizations: SmallBusinessAuthorization[]
  whitespace: WhitespaceRow[]
  newlyAuthorized: NewlyAuthorized[]
  params: { expiringWindowDays: number; newlyAuthorizedWindowDays: number }
  generatedAt: string
}

const SET_ASIDE_PRIORITY = ['SDVOSB', '8A', 'HUBZONE', 'WOSB', 'WOMAN_OWNED', 'VETERAN_OWNED']

export async function buildInsights(options?: {
  expiringWindowDays?: number
  newlyAuthorizedWindowDays?: number
  limit?: number
}): Promise<ComplianceInsights> {
  const now = new Date()
  const expiringWindowDays = options?.expiringWindowDays ?? 180
  const newWindowDays = options?.newlyAuthorizedWindowDays ?? 30
  const limit = Math.min(100, options?.limit ?? 25)

  const expiryCutoff = new Date(now.getTime() + expiringWindowDays * 24 * 60 * 60 * 1000)
  const newCutoff = new Date(now.getTime() - newWindowDays * 24 * 60 * 60 * 1000)
  const window = { gte: now, lte: expiryCutoff }

  const entitySelect = {
    select: {
      slug: true,
      name: true,
      businessSize: true,
      setAsides: true,
      totalFederalObligated: true,
      vendorSyncedAt: true,
    },
  } as const

  const [
    fedrampExpiring,
    dodExpiring,
    emassExpiring,
    fedrampAuthorized,
    dodAll,
    fedrampNew,
    dodNew,
  ] = await Promise.all([
    prisma.fedrampAuthorization.findMany({
      where: { expirationDate: window },
      select: { sponsoringAgency: true, expirationDate: true },
    }),
    prisma.dodProvisionalAuth.findMany({
      where: { paExpiration: window },
      select: { sponsorComponent: true, paExpiration: true },
    }),
    prisma.emassAuthorization.findMany({
      where: { expirationDate: window },
      select: { component: true, expirationDate: true },
    }),
    prisma.fedrampAuthorization.findMany({
      where: { entityId: { not: null } },
      include: { entity: entitySelect },
      take: 2000,
    }),
    prisma.dodProvisionalAuth.findMany({
      where: { entityId: { not: null } },
      include: { entity: entitySelect },
      take: 2000,
    }),
    prisma.fedrampAuthorization.findMany({
      where: { authorizationDate: { gte: newCutoff, lte: now } },
      include: { entity: { select: { slug: true, name: true } } },
      orderBy: { authorizationDate: 'desc' },
      take: limit,
    }),
    prisma.dodProvisionalAuth.findMany({
      where: { paDate: { gte: newCutoff, lte: now } },
      include: { entity: { select: { slug: true, name: true } } },
      orderBy: { paDate: 'desc' },
      take: limit,
    }),
  ])

  // (a) Agencies with the most expiring authorizations.
  const byAgency = new Map<string, ExpiringByAgency>()
  const addExpiring = (
    agency: string | null,
    date: Date | null,
    source: keyof ExpiringByAgency['sources']
  ) => {
    // Drops "Not In Process" and blanks, which are the majority of the column
    // and would otherwise dominate the ranking as a phantom agency.
    const key = cleanAgency(agency)
    if (!key) return
    const days = daysUntil(date, now)
    const existing = byAgency.get(key)
    if (existing) {
      existing.expiringCount++
      existing.sources[source]++
      if (days !== null && (existing.soonestDays === null || days < existing.soonestDays)) {
        existing.soonestDays = days
      }
      return
    }
    byAgency.set(key, {
      agency: key,
      expiringCount: 1,
      soonestDays: days,
      sources: { fedramp: 0, dodPa: 0, emass: 0, [source]: 1 } as ExpiringByAgency['sources'],
    })
  }

  for (const r of fedrampExpiring) addExpiring(r.sponsoringAgency, r.expirationDate, 'fedramp')
  for (const r of dodExpiring) addExpiring(r.sponsorComponent, r.paExpiration, 'dodPa')
  for (const r of emassExpiring) addExpiring(r.component, r.expirationDate, 'emass')

  const expiringByAgency = [...byAgency.values()]
    .sort((a, b) => b.expiringCount - a.expiringCount || (a.soonestDays ?? 1e9) - (b.soonestDays ?? 1e9))
    .slice(0, limit)

  // (b) Small-business / set-aside authorized offerings, highest level first.
  const smallBusinessAuthorizations: SmallBusinessAuthorization[] = []

  for (const r of fedrampAuthorized) {
    if (!r.entity) continue
    const setAsides = safeJsonArray(r.entity.setAsides)
    // FedRAMP publishes its own small-business flag. Prefer it: Entity.businessSize
    // comes from SAM and only exists once vendor enrichment has run, so relying
    // on it alone empties this list for the entire un-enriched universe.
    const qualifies =
      r.smallBusiness === true || r.entity.businessSize === 'SMALL' || setAsides.length > 0
    if (!qualifies || !isAuthorized(r.status)) continue
    smallBusinessAuthorizations.push({
      entitySlug: r.entity.slug,
      entityName: r.entity.name,
      offering: r.csoName,
      impactLevel: r.impactLevel,
      setAsides,
      businessSize: r.entity.businessSize ?? (r.smallBusiness ? 'SMALL' : null),
      totalFederalObligated: r.entity.totalFederalObligated,
      source: 'fedramp',
    })
  }
  for (const r of dodAll) {
    if (!r.entity) continue
    const setAsides = safeJsonArray(r.entity.setAsides)
    if (r.entity.businessSize !== 'SMALL' && setAsides.length === 0) continue
    smallBusinessAuthorizations.push({
      entitySlug: r.entity.slug,
      entityName: r.entity.name,
      offering: r.csoName,
      impactLevel: r.impactLevel,
      setAsides,
      businessSize: r.entity.businessSize,
      totalFederalObligated: r.entity.totalFederalObligated,
      source: 'dod-pa',
    })
  }

  smallBusinessAuthorizations.sort((a, b) => {
    const levelDelta = levelRank(b.impactLevel) - levelRank(a.impactLevel)
    if (levelDelta !== 0) return levelDelta
    // Then by how "targeted" the set-aside is — SDVOSB and 8(a) are the ones
    // acquisition shops are actively hunting for.
    const aPriority = Math.min(
      ...a.setAsides.map((s) => SET_ASIDE_PRIORITY.indexOf(s)).filter((i) => i >= 0),
      99
    )
    const bPriority = Math.min(
      ...b.setAsides.map((s) => SET_ASIDE_PRIORITY.indexOf(s)).filter((i) => i >= 0),
      99
    )
    return aPriority - bPriority
  })

  // (c) Whitespace: authorized to operate, zero recorded federal obligations.
  // The headline finding — a vendor cleared the hardest gate and is still
  // winning nothing.
  //
  // `vendorSyncedAt` is a required gate, not a nicety. `totalFederalObligated`
  // is a cache written by syncVendor; for an unenriched vendor it is null,
  // meaning UNKNOWN. Treating null as zero would list every vendor the
  // enrichment pass hasn't reached yet — including primes with billions in
  // obligations — as having won nothing.
  const hasSpendData = (e: { vendorSyncedAt: Date | null }) => e.vendorSyncedAt !== null

  const whitespace: WhitespaceRow[] = []
  for (const r of fedrampAuthorized) {
    if (!r.entity || !isAuthorized(r.status)) continue
    if (!hasSpendData(r.entity)) continue
    if ((r.entity.totalFederalObligated ?? 0) > 0) continue
    whitespace.push({
      entitySlug: r.entity.slug,
      entityName: r.entity.name,
      offering: r.csoName,
      impactLevel: r.impactLevel,
      sponsoringAgency: cleanAgency(r.sponsoringAgency),
      authorizationDate: r.authorizationDate?.toISOString() ?? null,
      source: 'fedramp',
    })
  }
  for (const r of dodAll) {
    if (!r.entity) continue
    if (!hasSpendData(r.entity)) continue
    if ((r.entity.totalFederalObligated ?? 0) > 0) continue
    whitespace.push({
      entitySlug: r.entity.slug,
      entityName: r.entity.name,
      offering: r.csoName,
      impactLevel: r.impactLevel,
      sponsoringAgency: cleanAgency(r.sponsorComponent),
      authorizationDate: r.paDate?.toISOString() ?? null,
      source: 'dod-pa',
    })
  }
  whitespace.sort((a, b) => levelRank(b.impactLevel) - levelRank(a.impactLevel))

  // (d) Newly authorized in the last N days.
  const newlyAuthorized: NewlyAuthorized[] = [
    ...fedrampNew.map((r): NewlyAuthorized => ({
      entitySlug: r.entity?.slug ?? null,
      vendor: r.entity?.name ?? r.cspName,
      offering: r.csoName,
      impactLevel: r.impactLevel,
      authorizationDate: r.authorizationDate?.toISOString() ?? null,
      sponsoringAgency: cleanAgency(r.sponsoringAgency),
      source: 'fedramp',
    })),
    ...dodNew.map((r): NewlyAuthorized => ({
      entitySlug: r.entity?.slug ?? null,
      vendor: r.entity?.name ?? r.cspName,
      offering: r.csoName,
      impactLevel: r.impactLevel,
      authorizationDate: r.paDate?.toISOString() ?? null,
      sponsoringAgency: cleanAgency(r.sponsorComponent),
      source: 'dod-pa',
    })),
  ]
    .sort((a, b) => (b.authorizationDate ?? '').localeCompare(a.authorizationDate ?? ''))
    .slice(0, limit)

  return {
    expiringByAgency,
    smallBusinessAuthorizations: smallBusinessAuthorizations.slice(0, limit),
    whitespace: whitespace.slice(0, limit),
    newlyAuthorized,
    params: { expiringWindowDays, newlyAuthorizedWindowDays: newWindowDays },
    generatedAt: now.toISOString(),
  }
}
