import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Vendor directory — searchable/filterable list of vendors for acquisition
 * market research. Returns cached vendor-intel fields on Entity (populated by
 * syncVendor); the per-vendor dossier holds the full detail.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.vendor)
  if (limited.response) return limited.response

  const sp = request.nextUrl.searchParams
  const search = sp.get('search') || ''
  const size = sp.get('size') || '' // SMALL
  const hasRisk = sp.get('risk') === '1'
  const sort = sp.get('sort') || 'obligated'
  const page = Math.max(1, parseInt(sp.get('page') || '1'))
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '50')))
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = {
    type: { notIn: ['GOVERNMENT', 'INVESTOR'] },
  }
  if (search) where.name = { contains: search }
  if (size) where.businessSize = size
  if (hasRisk) where.riskFlags = { not: '[]' }

  const orderBy =
    sort === 'name'
      ? { name: 'asc' as const }
      : sort === 'recent'
      ? { vendorSyncedAt: 'desc' as const }
      : { totalFederalObligated: 'desc' as const }

  const [rows, total] = await Promise.all([
    prisma.entity.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        name: true, slug: true, type: true, businessSize: true,
        setAsides: true, riskFlags: true, primaryAgency: true,
        totalFederalObligated: true, vendorSyncedAt: true,
        headquartersCountry: { select: { alpha2: true, name: true } },
      },
    }),
    prisma.entity.count({ where }),
  ])

  const vendors = rows.map((r) => ({
    name: r.name,
    slug: r.slug,
    type: r.type,
    businessSize: r.businessSize,
    setAsides: safeArr(r.setAsides),
    riskFlags: safeArr(r.riskFlags),
    primaryAgency: r.primaryAgency,
    totalFederalObligated: r.totalFederalObligated,
    enriched: Boolean(r.vendorSyncedAt),
    country: r.headquartersCountry,
  }))

  return NextResponse.json({ vendors, total, page, limit }, { headers: limited.headers })
}

function safeArr(v: string | null): string[] {
  if (!v) return []
  try {
    const p = JSON.parse(v)
    return Array.isArray(p) ? p : []
  } catch {
    return []
  }
}
