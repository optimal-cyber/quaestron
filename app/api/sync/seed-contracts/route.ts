import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'

const SEARCH_COMPANIES = [
  'Palantir', 'Anduril', 'L3Harris', 'Raytheon', 'Northrop Grumman',
  'Lockheed Martin', 'BAE Systems', 'General Dynamics', 'Boeing', 'Leidos',
  'SAIC', 'Booz Allen Hamilton', 'ManTech', 'CACI International',
  'Accenture Federal', 'Amazon Web Services', 'Microsoft', 'Google',
  'Oracle', 'IBM', 'Thales', 'Elbit Systems', 'Cellebrite',
  'Shield AI', 'Skydio', 'Dataminr', 'Clearview AI', 'Babel Street',
]

interface USASpendingResult {
  'Award ID': string
  'Recipient Name': string
  'Award Amount': number
  'Awarding Agency': string
  'Awarding Sub Agency': string
  'Start Date': string
  'End Date': string
  Description: string
}

async function searchContracts(keyword: string): Promise<USASpendingResult[]> {
  try {
    const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          keywords: [keyword],
          award_type_codes: ['A', 'B', 'C', 'D'],
          time_period: [{ start_date: '2020-01-01', end_date: '2026-12-31' }],
        },
        fields: [
          'Award ID', 'Recipient Name', 'Award Amount',
          'Awarding Agency', 'Awarding Sub Agency',
          'Start Date', 'End Date', 'Description',
        ],
        limit: 20,
        page: 1,
        sort: 'Award Amount',
        order: 'desc',
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.results || []
  } catch {
    return []
  }
}

async function findOrCreateAgency(agencyName: string): Promise<string | null> {
  if (!agencyName) return null
  const slug = agencyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const existing = await prisma.entity.findUnique({ where: { slug } })
  if (existing) return existing.id
  const entity = await prisma.entity.create({
    data: { name: agencyName, slug, type: 'GOVERNMENT', description: `U.S. federal agency: ${agencyName}` },
  })
  return entity.id
}

// POST to trigger manually, GET for cron
export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request, { allowCronSecret: true })
  if (!admin.ok) return admin.response

  const start = Date.now()
  let totalContracts = 0
  let totalValue = 0
  const log: string[] = []

  for (const companyName of SEARCH_COMPANIES) {
    const entity = await prisma.entity.findFirst({
      where: {
        OR: [
          { name: { contains: companyName } },
          { slug: { contains: companyName.toLowerCase().replace(/\s+/g, '-') } },
        ],
      },
    })

    if (!entity) {
      log.push(`Skip: no entity for "${companyName}"`)
      continue
    }

    const results = await searchContracts(companyName)
    let added = 0

    for (const award of results) {
      if (!award['Award ID']) continue
      const existing = await prisma.contract.findUnique({ where: { awardId: award['Award ID'] } })
      if (existing) continue

      const agencyName = award['Awarding Sub Agency'] || award['Awarding Agency']
      const agencyId = await findOrCreateAgency(agencyName)

      const awardDate = award['Start Date'] ? new Date(award['Start Date']) : null
      const endDate = award['End Date'] ? new Date(award['End Date']) : null

      await prisma.contract.create({
        data: {
          awardId: award['Award ID'],
          entityId: entity.id,
          agencyId,
          description: award['Description'] || null,
          value: award['Award Amount'] || null,
          awardDate: awardDate && !isNaN(awardDate.getTime()) ? awardDate : null,
          endDate: endDate && !isNaN(endDate.getTime()) ? endDate : null,
          sources: JSON.stringify([{
            url: `https://www.usaspending.gov/award/${award['Award ID']}`,
            title: `USAspending Award ${award['Award ID']}`,
            domain: 'usaspending.gov',
          }]),
        },
      })
      added++
      totalValue += award['Award Amount'] || 0
    }

    totalContracts += added
    if (added > 0) log.push(`${entity.name}: +${added} contracts`)

    // Rate limit
    await new Promise((r) => setTimeout(r, 300))
  }

  return NextResponse.json({
    success: true,
    elapsed: `${((Date.now() - start) / 1000).toFixed(1)}s`,
    totalContracts,
    totalValue,
    log,
  })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
