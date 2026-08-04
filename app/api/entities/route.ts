import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.entities)
  if (limited.response) return limited.response

  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') || ''
  const types = searchParams.get('types')?.split(',').filter(Boolean) || []
  const sort = searchParams.get('sort') || 'name'
  const direction = searchParams.get('direction') || 'asc'
  const limit = parseInt(searchParams.get('limit') || '2000')
  const offset = parseInt(searchParams.get('offset') || '0')

  const where: Record<string, unknown> = {}

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { slug: { contains: search.toLowerCase() } },
      { description: { contains: search } },
    ]
  }

  if (types.length > 0) {
    where.type = { in: types }
  }

  const country = searchParams.get('country')
  if (country) {
    where.headquartersCountry = { name: country }
  }

  const entities = await prisma.entity.findMany({
    where,
    include: {
      headquartersCountry: true,
      _count: {
        select: {
          connectionsFrom: true,
          connectionsTo: true,
        },
      },
    },
    orderBy: sort === 'name'
      ? { name: direction as 'asc' | 'desc' }
      : sort === 'connections'
        ? { connectionsFrom: { _count: direction as 'asc' | 'desc' } }
        : { name: 'asc' },
    take: limit,
    skip: offset,
  })

  const total = await prisma.entity.count({ where })

  const result = entities.map((e) => {
    const providingTo = JSON.parse(e.providingTo)
    const surveilling = JSON.parse(e.surveilling)
    return {
      ...e,
      subTypes: JSON.parse(e.subTypes),
      alsoKnownAs: JSON.parse(e.alsoKnownAs),
      sources: JSON.parse(e.sources),
      naicsCodes: JSON.parse(e.naicsCodes),
      providingTo,
      surveilling,
      connectionCount: e._count.connectionsFrom + e._count.connectionsTo + providingTo.length + surveilling.length,
    }
  })

  return NextResponse.json({ entities: result, total }, { headers: limited.headers })
}
