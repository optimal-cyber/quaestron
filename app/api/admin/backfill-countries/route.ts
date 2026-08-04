import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'

// Known HQ countries for companies in the system (alpha2 codes)
// Defaults to US if not listed — most tracked entities are US defense contractors
const KNOWN_HQ: Record<string, string> = {
  'BAE Systems': 'GB',
  'Thales': 'FR',
  'Elbit Systems': 'IL',
  'Cellebrite': 'IL',
  'Cobham': 'GB',
  'Leonardo DRS': 'IT',
  'DroneShield': 'AU',
  // Government agencies are US
  'Department of Defense': 'US',
  'Department of the Air Force': 'US',
  'Department of the Army': 'US',
  'Department of the Navy': 'US',
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request, { allowCronSecret: true })
  if (!admin.ok) return admin.response

  // Find entities without a headquartersCountry
  const orphans = await prisma.entity.findMany({
    where: { headquartersCountryId: null },
    select: { id: true, name: true, type: true },
  })

  if (orphans.length === 0) {
    return NextResponse.json({ message: 'All entities already have HQ countries', updated: 0 })
  }

  // Pre-fetch all countries for quick lookup
  const countries = await prisma.country.findMany()
  const countryByAlpha2 = new Map(countries.map(c => [c.alpha2, c.id]))

  let updated = 0
  const log: string[] = []

  for (const entity of orphans) {
    const alpha2 = KNOWN_HQ[entity.name] || 'US'
    const countryId = countryByAlpha2.get(alpha2)

    if (!countryId) {
      log.push(`No country record for ${alpha2} — skipping ${entity.name}`)
      continue
    }

    await prisma.entity.update({
      where: { id: entity.id },
      data: { headquartersCountryId: countryId },
    })
    updated++
    log.push(`${entity.name} → ${alpha2}`)
  }

  return NextResponse.json({
    success: true,
    totalOrphans: orphans.length,
    updated,
    log,
  })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
