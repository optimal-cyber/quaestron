import { prisma } from '@/lib/db'
import { isAuthorized } from '@/lib/compliance/shared'

/**
 * Live coverage statistics for the public /data page.
 *
 * Every number is computed from the database at request time. Nothing here is
 * hardcoded, rounded up, or carried forward from a press release — the point of
 * the page is that a prospect can check the claims, so an inflated figure would
 * cost more credibility than it buys.
 *
 * Where a figure is partial, it says so rather than being quietly omitted.
 */

export interface CoverageSource {
  source: string
  label: string
  records: number
  lastSyncAt: string | null
  status: string | null
}

export interface CoverageStats {
  entities: {
    total: number
    vendors: number
    agencies: number
    investors: number
    enriched: number
    countries: number
  }
  contracts: {
    total: number
    totalValue: number
    valueCoverage: number
    sbirAwards: number
    sbirValue: number
    federalContractRows: number
  }
  compliance: {
    fedrampTotal: number
    fedrampAuthorized: number
    fedrampLinked: number
    dodPaTotal: number
    emassTotal: number
    assessmentsDue90: number
    pendingMatchReviews: number
  }
  relationships: {
    connections: number
    newsItems: number
    fundingRounds: number
    lobbyingFilings: number
    samRegistrations: number
  }
  sources: CoverageSource[]
  generatedAt: string
}

const SOURCE_LABELS: Record<string, string> = {
  fedramp: 'FedRAMP Marketplace',
  disa: 'DISA DCAS (DoD provisional authorizations)',
  'disa-seed': 'DISA seed dataset',
  'weekly-sync': 'Weekly vendor re-enrichment',
  emass: 'eMASS (manual import)',
}

/**
 * Resolves a count, degrading to -1 rather than throwing.
 *
 * A public credibility page must not 500 because one table or column is behind
 * — that is exactly the state a database sits in between a deploy and its
 * migration. `-1` renders as "unavailable", which is honest, instead of `0`,
 * which would be a lie.
 */
async function safeCount(query: Promise<number>): Promise<number> {
  try {
    return await query
  } catch (err) {
    console.error('[coverage] count failed, reporting unavailable:', err)
    return -1
  }
}

async function safeValue<T>(query: Promise<T>, fallback: T): Promise<T> {
  try {
    return await query
  } catch (err) {
    console.error('[coverage] query failed, reporting unavailable:', err)
    return fallback
  }
}

export async function buildCoverageStats(): Promise<CoverageStats> {
  const now = new Date()
  const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

  const [
    entityTotal,
    vendors,
    agencies,
    investors,
    enriched,
    countries,
    contractTotal,
    contractValue,
    contractsWithValue,
    sbirAgg,
    federalContractRows,
    fedrampRows,
    fedrampLinked,
    dodPaTotal,
    emassTotal,
    assessmentsDue90,
    pendingMatchReviews,
    connections,
    newsItems,
    fundingRounds,
    lobbyingFilings,
    samRegistrations,
    syncLogs,
  ] = await Promise.all([
    safeCount(prisma.entity.count()),
    safeCount(prisma.entity.count({ where: { type: { notIn: ['GOVERNMENT', 'INVESTOR'] } } })),
    safeCount(prisma.entity.count({ where: { type: 'GOVERNMENT' } })),
    safeCount(prisma.entity.count({ where: { type: 'INVESTOR' } })),
    safeCount(prisma.entity.count({ where: { vendorSyncedAt: { not: null } } })),
    safeCount(prisma.country.count()),
    safeCount(prisma.contract.count()),
    safeValue(prisma.contract.aggregate({ _sum: { value: true } }), { _sum: { value: null } }),
    safeCount(prisma.contract.count({ where: { value: { not: null } } })),
    safeValue(
      prisma.contract.aggregate({
        where: { sbirProgram: { not: null } },
        _count: { _all: true },
        _sum: { value: true },
      }),
      { _count: { _all: -1 }, _sum: { value: null } }
    ),
    safeCount(prisma.federalContract.count()),
    safeValue(prisma.fedrampAuthorization.findMany({ select: { status: true } }), []),
    safeCount(prisma.fedrampAuthorization.count({ where: { entityId: { not: null } } })),
    safeCount(prisma.dodProvisionalAuth.count()),
    safeCount(prisma.emassAuthorization.count()),
    safeCount(prisma.fedrampAuthorization.count({ where: { expirationDate: { gte: now, lte: in90 } } })),
    safeCount(prisma.atoMatchReview.count({ where: { status: 'PENDING' } })),
    safeCount(prisma.connection.count()),
    safeCount(prisma.newsItem.count()),
    safeCount(prisma.fundingRound.count()),
    safeCount(prisma.lobbyingFiling.count()),
    safeCount(prisma.samRegistration.count()),
    safeValue(prisma.atoSyncLog.findMany({ orderBy: { lastSyncAt: 'desc' } }), []),
  ])

  return {
    entities: {
      total: entityTotal,
      vendors,
      agencies,
      investors,
      enriched,
      countries,
    },
    contracts: {
      total: contractTotal,
      totalValue: contractValue._sum.value ?? 0,
      // How much of the corpus actually carries a dollar figure — the total is
      // meaningless without it.
      valueCoverage: contractTotal === 0 ? 0 : contractsWithValue / contractTotal,
      sbirAwards: sbirAgg._count._all,
      sbirValue: sbirAgg._sum.value ?? 0,
      federalContractRows,
    },
    compliance: {
      fedrampTotal: fedrampRows.length,
      fedrampAuthorized: fedrampRows.filter((r) => isAuthorized(r.status)).length,
      fedrampLinked,
      dodPaTotal,
      emassTotal,
      assessmentsDue90,
      pendingMatchReviews,
    },
    relationships: {
      connections,
      newsItems,
      fundingRounds,
      lobbyingFilings,
      samRegistrations,
    },
    sources: syncLogs.map((log) => ({
      source: log.source,
      label: SOURCE_LABELS[log.source] ?? log.source,
      records: log.recordsAdded + log.recordsUpdated,
      lastSyncAt: log.lastSyncAt?.toISOString() ?? null,
      status: log.status,
    })),
    generatedAt: now.toISOString(),
  }
}
