import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Rows whose offering has left the DCAS file. `source` is a provenance field
// being overloaded as a stopgap until #15 adds lifecycleState; the point is that
// a withdrawn authorization must not read as a current one, and that cannot wait
// for a schema change.
const NOT_WITHDRAWN = { source: { not: 'withdrawn-pending-review' } }

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const impactLevel = sp.get('impactLevel')
    const search = sp.get('search') || ''
    const page = Math.max(1, parseInt(sp.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '50')))
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = { ...NOT_WITHDRAWN }

    if (impactLevel) {
      where.impactLevel = impactLevel
    }

    if (search) {
      where.OR = [
        { csoName: { contains: search } },
        { cspName: { contains: search } },
      ]
    }

    const [authorizations, total] = await Promise.all([
      prisma.dodProvisionalAuth.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.dodProvisionalAuth.count({ where }),
    ])

    return NextResponse.json({ authorizations, total, page, limit })
  } catch (error) {
    console.error('[ATO] Error fetching DoD PA records:', error)
    return NextResponse.json(
      { error: 'Failed to fetch DoD provisional authorizations' },
      { status: 500 }
    )
  }
}
