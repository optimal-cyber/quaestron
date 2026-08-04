import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.search)
  if (limited.response) return limited.response

  const query = request.nextUrl.searchParams.get('q') || ''

  if (query.length < 2) {
    return NextResponse.json({ results: [] }, { headers: limited.headers })
  }

  const entities = await prisma.entity.findMany({
    where: {
      OR: [
        { name: { contains: query } },
        { slug: { contains: query.toLowerCase() } },
        { alsoKnownAs: { contains: query } },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      headquartersCountry: { select: { name: true, alpha2: true } },
      _count: { select: { connectionsFrom: true, connectionsTo: true } },
    },
    take: 20,
  })

  const results = entities.map((e) => ({
    ...e,
    connectionCount: e._count.connectionsFrom + e._count.connectionsTo,
    category: 'entity' as const,
  }))

  return NextResponse.json({ results }, { headers: limited.headers })
}
