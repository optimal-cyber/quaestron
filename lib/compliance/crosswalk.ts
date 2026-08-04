import { prisma } from '@/lib/db'
import {
  cleanAgency,
  daysUntil,
  highestLevel,
  isAuthorized,
  levelRank,
  safeAgencyBreakdown,
  safeJsonArray,
  type AgencyBreakdownRow,
} from './shared'

/**
 * The ATO ↔ contract crosswalk: one vendor's compliance posture and federal
 * spend in a single object.
 *
 * This is the platform's differentiating view — "who is authorized, at what
 * level, sponsored by whom, and are they actually winning work there" is a
 * question you currently cannot answer from FedRAMP Marketplace or USASpending
 * alone, because neither side knows about the other.
 *
 * Authorizations are read through the `entityId` FKs backfilled by
 * prisma/backfill-ato-entities.ts, with a name-based fallback for rows the
 * matcher has not resolved yet.
 */

export interface CrosswalkAuthorizationSummary {
  total: number
  active: number
  expiringWithin90: number
  expiringWithin180: number
  highestImpactLevel: string | null
  levels: string[]
}

export interface AgencyLeverageRow {
  agency: string
  /** How this agency shows up for the vendor. */
  roles: ('sponsor' | 'leveraging' | 'obligations')[]
  awardCount: number
  totalObligated: number
  authorizationCount: number
}

export interface Crosswalk {
  entity: {
    id: string
    name: string
    slug: string
    type: string
    description: string
    website: string | null
    uei: string | null
    cageCode: string | null
    businessSize: string | null
    setAsides: string[]
    riskFlags: string[]
    headquartersCity: string | null
    headquartersCountry: { name: string; alpha2: string } | null
    vendorSyncedAt: string | null
  }
  authorizations: {
    fedramp: {
      packageId: string
      csoName: string
      cspName: string
      status: string
      impactLevel: string | null
      serviceModel: string[]
      deploymentModel: string | null
      authType: string | null
      authorizationDate: string | null
      expirationDate: string | null
      daysRemaining: number | null
      sponsoringAgency: string | null
      leveragingAgencies: string[]
      matchedByName: boolean
    }[]
    dodPa: {
      id: string
      csoName: string
      impactLevel: string
      paDate: string | null
      paExpiration: string | null
      daysRemaining: number | null
      sponsorComponent: string | null
      matchedByName: boolean
    }[]
    emass: {
      id: string
      systemName: string
      component: string
      authorizationType: string
      impactLevel: string | null
      authorizationDate: string | null
      expirationDate: string | null
      daysRemaining: number | null
      matchedByName: boolean
    }[]
    summary: CrosswalkAuthorizationSummary
  }
  spend: {
    totalFederalObligated: number
    primaryAgency: string | null
    agencyBreakdown: AgencyBreakdownRow[]
    contractCount: number
    topContracts: {
      id: string
      description: string | null
      value: number | null
      agency: string | null
      awardDate: string | null
    }[]
  }
  sbir: {
    totalAwards: number
    totalValue: number
    byPhase: Record<string, { count: number; value: number }>
  }
  agencyLeverage: AgencyLeverageRow[]
  /**
   * Authorized to operate but with no federal obligations on record.
   *
   * Only ever true when spend data actually exists to be zero — see
   * `spendDataAvailable`. A vendor whose enrichment has never run has unknown
   * spend, not zero spend, and claiming otherwise would assert that a major
   * prime has never won federal work.
   */
  whitespace: boolean
  /** False when vendor enrichment hasn't run, so spend figures mean nothing. */
  spendDataAvailable: boolean
  generatedAt: string
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

/**
 * Rows the matcher hasn't linked yet still surface, matched on name, and are
 * flagged `matchedByName` so the UI can mark them provisional rather than
 * quietly presenting a guess as fact.
 */
function nameFallback(entityName: string) {
  const stripped = entityName
    .replace(/\b(Inc|LLC|Corp|Corporation|Technologies|Systems|Government Solutions)\b/gi, '')
    .trim()
  return stripped.length >= 4 ? stripped : entityName
}

export async function buildCrosswalk(slugOrId: string): Promise<Crosswalk | null> {
  const entity = await prisma.entity.findFirst({
    where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
    include: { headquartersCountry: { select: { name: true, alpha2: true } } },
  })
  if (!entity) return null

  const fallback = nameFallback(entity.name)
  const now = new Date()

  const [fedrampRows, dodRows, emassRows, contracts, sbirRows] = await Promise.all([
    prisma.fedrampAuthorization.findMany({
      where: { OR: [{ entityId: entity.id }, { entityId: null, cspName: { contains: fallback } }] },
      orderBy: [{ expirationDate: 'asc' }],
      take: 100,
    }),
    prisma.dodProvisionalAuth.findMany({
      where: { OR: [{ entityId: entity.id }, { entityId: null, cspName: { contains: fallback } }] },
      orderBy: [{ paExpiration: 'asc' }],
      take: 100,
    }),
    prisma.emassAuthorization.findMany({
      where: {
        OR: [
          { entityId: entity.id },
          { entityId: null, cloudProvider: { contains: fallback } },
        ],
      },
      orderBy: [{ expirationDate: 'asc' }],
      take: 100,
    }),
    prisma.contract.findMany({
      where: { entityId: entity.id, sbirProgram: null },
      include: { agency: { select: { name: true } } },
      orderBy: { value: 'desc' },
      take: 10,
    }),
    prisma.contract.findMany({
      where: { entityId: entity.id, sbirProgram: { not: null } },
      select: { value: true, sbirPhase: true },
      take: 500,
    }),
  ])

  const contractCount = await prisma.contract.count({
    where: { entityId: entity.id, sbirProgram: null },
  })

  const fedramp = fedrampRows.map((r) => ({
    packageId: r.packageId,
    csoName: r.csoName,
    cspName: r.cspName,
    status: r.status,
    impactLevel: r.impactLevel,
    serviceModel: safeJsonArray(r.serviceModel),
    deploymentModel: r.deploymentModel,
    authType: r.authType,
    authorizationDate: iso(r.authorizationDate),
    expirationDate: iso(r.expirationDate),
    daysRemaining: daysUntil(r.expirationDate, now),
    sponsoringAgency: cleanAgency(r.sponsoringAgency),
    leveragingAgencies: safeJsonArray(r.leveragingAgencies).filter((a) => cleanAgency(a) !== null),
    matchedByName: r.entityId !== entity.id,
  }))

  const dodPa = dodRows.map((r) => ({
    id: r.id,
    csoName: r.csoName,
    impactLevel: r.impactLevel,
    paDate: iso(r.paDate),
    paExpiration: iso(r.paExpiration),
    daysRemaining: daysUntil(r.paExpiration, now),
    sponsorComponent: cleanAgency(r.sponsorComponent),
    matchedByName: r.entityId !== entity.id,
  }))

  const emass = emassRows.map((r) => ({
    id: r.id,
    systemName: r.systemName,
    component: r.component,
    authorizationType: r.authorizationType,
    impactLevel: r.impactLevel,
    authorizationDate: iso(r.authorizationDate),
    expirationDate: iso(r.expirationDate),
    daysRemaining: daysUntil(r.expirationDate, now),
    matchedByName: r.entityId !== entity.id,
  }))

  const allDaysRemaining = [
    ...fedramp.map((f) => f.daysRemaining),
    ...dodPa.map((d) => d.daysRemaining),
    ...emass.map((e) => e.daysRemaining),
  ].filter((d): d is number => d !== null && d >= 0)

  const levels = [
    ...fedramp.map((f) => f.impactLevel),
    ...dodPa.map((d) => d.impactLevel),
    ...emass.map((e) => e.impactLevel),
  ].filter((l): l is string => Boolean(l))

  const summary: CrosswalkAuthorizationSummary = {
    total: fedramp.length + dodPa.length + emass.length,
    active:
      fedramp.filter((f) => isAuthorized(f.status)).length +
      dodPa.length +
      emass.filter((e) => e.authorizationType !== 'DATO').length,
    expiringWithin90: allDaysRemaining.filter((d) => d <= 90).length,
    expiringWithin180: allDaysRemaining.filter((d) => d <= 180).length,
    highestImpactLevel: highestLevel(levels),
    levels: [...new Set(levels)].sort((a, b) => levelRank(b) - levelRank(a)),
  }

  const agencyBreakdown = safeAgencyBreakdown(entity.agencyBreakdown)
  const totalFederalObligated = entity.totalFederalObligated ?? 0
  // `totalFederalObligated` and `agencyBreakdown` are caches written by
  // syncVendor. Absent enrichment they are null, which is "unknown", not "zero".
  const spendDataAvailable = entity.vendorSyncedAt !== null

  // Agency leverage map: one row per agency, tagging every way it touches this
  // vendor — sponsoring an authorization, leveraging someone else's, or
  // actually obligating money. The gap between the last one and the first two
  // is the interesting signal.
  const leverage = new Map<string, AgencyLeverageRow>()
  const touch = (agency: string | null, role: AgencyLeverageRow['roles'][number]) => {
    const key = cleanAgency(agency)
    if (!key) return
    const existing = leverage.get(key)
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role)
      if (role !== 'obligations') existing.authorizationCount++
      return
    }
    leverage.set(key, {
      agency: key,
      roles: [role],
      awardCount: 0,
      totalObligated: 0,
      authorizationCount: role === 'obligations' ? 0 : 1,
    })
  }

  for (const f of fedramp) {
    if (f.sponsoringAgency) touch(f.sponsoringAgency, 'sponsor')
    for (const a of f.leveragingAgencies) touch(a, 'leveraging')
  }
  for (const d of dodPa) if (d.sponsorComponent) touch(d.sponsorComponent, 'sponsor')
  for (const e of emass) touch(e.component, 'sponsor')

  for (const row of agencyBreakdown) {
    touch(row.agency, 'obligations')
    const entry = leverage.get(cleanAgency(row.agency) ?? '')
    if (entry) {
      entry.awardCount = row.awardCount
      entry.totalObligated = row.totalObligated
    }
  }

  const agencyLeverage = [...leverage.values()].sort(
    (a, b) => b.totalObligated - a.totalObligated || b.authorizationCount - a.authorizationCount
  )

  const byPhase: Record<string, { count: number; value: number }> = {}
  let sbirTotalValue = 0
  for (const row of sbirRows) {
    const phase = row.sbirPhase || 'Unknown'
    byPhase[phase] ??= { count: 0, value: 0 }
    byPhase[phase].count++
    byPhase[phase].value += row.value || 0
    sbirTotalValue += row.value || 0
  }

  return {
    entity: {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      type: entity.type,
      description: entity.description,
      website: entity.website,
      uei: entity.uei,
      cageCode: entity.cageCode,
      businessSize: entity.businessSize,
      setAsides: safeJsonArray(entity.setAsides),
      riskFlags: safeJsonArray(entity.riskFlags),
      headquartersCity: entity.headquartersCity,
      headquartersCountry: entity.headquartersCountry,
      vendorSyncedAt: iso(entity.vendorSyncedAt),
    },
    authorizations: { fedramp, dodPa, emass, summary },
    spend: {
      totalFederalObligated,
      primaryAgency: entity.primaryAgency,
      agencyBreakdown,
      contractCount,
      topContracts: contracts.map((c) => ({
        id: c.id,
        description: c.description,
        value: c.value,
        agency: c.agency?.name ?? null,
        awardDate: iso(c.awardDate),
      })),
    },
    sbir: { totalAwards: sbirRows.length, totalValue: sbirTotalValue, byPhase },
    agencyLeverage,
    whitespace:
      spendDataAvailable && summary.active > 0 && totalFederalObligated === 0 && contractCount === 0,
    spendDataAvailable,
    generatedAt: now.toISOString(),
  }
}
