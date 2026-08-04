import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'

/**
 * Fix mismatched entity-contract assignments caused by fuzzy `contains` matching.
 * Creates proper entities for SAIC and CACI, then reassigns their contracts.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request, { allowCronSecret: true })
  if (!admin.ok) return admin.response

  const us = await prisma.country.findUnique({ where: { alpha2: 'US' } })
  const log: string[] = []

  // Fixes to apply: [wrongEntitySlugContains, correctName, correctSlug, correctType]
  const fixes: Array<{
    wrongNameContains: string
    correctName: string
    correctSlug: string
    correctType: string
    description: string
  }> = [
    {
      wrongNameContains: 'Mosaic',
      correctName: 'SAIC',
      correctSlug: 'saic',
      correctType: 'DEFENSE_PRIME',
      description: 'Science Applications International Corporation — defense IT services and solutions contractor',
    },
    {
      wrongNameContains: 'Acacia',
      correctName: 'CACI',
      correctSlug: 'caci',
      correctType: 'DEFENSE_PRIME',
      description: 'CACI International — defense IT, intelligence, and cybersecurity contractor',
    },
  ]

  for (const fix of fixes) {
    // Find or create the correct entity
    let correctEntity = await prisma.entity.findFirst({
      where: { slug: fix.correctSlug },
    })

    if (!correctEntity) {
      correctEntity = await prisma.entity.create({
        data: {
          name: fix.correctName,
          slug: fix.correctSlug,
          type: fix.correctType,
          description: fix.description,
          headquartersCountryId: us?.id || null,
        },
      })
      log.push(`Created entity: ${fix.correctName} (${correctEntity.id})`)
    } else {
      log.push(`${fix.correctName} already exists (${correctEntity.id})`)
    }

    // Find the wrong entity
    const wrongEntity = await prisma.entity.findFirst({
      where: {
        name: { contains: fix.wrongNameContains },
        id: { not: correctEntity.id },
      },
    })

    if (wrongEntity) {
      // Move contracts from wrong entity to correct entity
      const moved = await prisma.contract.updateMany({
        where: { entityId: wrongEntity.id },
        data: { entityId: correctEntity.id },
      })
      log.push(`Moved ${moved.count} contracts from "${wrongEntity.name}" to "${fix.correctName}"`)
    } else {
      log.push(`No wrong entity found for "${fix.wrongNameContains}" — skipping`)
    }
  }

  return NextResponse.json({ success: true, log })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
