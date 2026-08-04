import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'

/**
 * Broader federal contracts sync from USAspending.gov
 * Unlike seed-sbir which only pulls SBIR/STTR awards, this pulls ALL federal
 * contract awards for tracked companies — showing the full picture of who the
 * government is funding and for what.
 */

// Reuse search aliases from SBIR sync for legal name matching
const SEARCH_ALIASES: Record<string, string[]> = {
  'SpaceX': ['Space Exploration Technologies'],
  'Raytheon': ['Raytheon', 'RTX'],
  'RTX': ['RTX', 'Raytheon'],
  'Booz Allen': ['Booz Allen Hamilton'],
  'CACI': ['CACI International', 'CACI Inc'],
  'SAIC': ['Science Applications International', 'SAIC'],
  'ManTech': ['ManTech International', 'ManTech'],
  'Shield AI': ['Shield AI'],
  'Scale AI': ['Scale AI', 'Scale.AI'],
  'Primer AI': ['Primer Federal', 'Primer Inc'],
  'Planet Labs': ['Planet Labs PBC', 'Planet Federal'],
  'Hawkeye 360': ['HawkEye 360'],
  'Leonardo DRS': ['DRS Defense Solutions', 'Leonardo DRS'],
  'BigBear AI': ['BigBear.ai', 'BigBear AI'],
  'C3 AI': ['C3.ai', 'C3 AI Federal'],
  'Joby Aviation': ['Joby Aviation', 'Joby Aero'],
  'Second Front': ['Second Front Systems'],
  'Firestorm': ['Firestorm Labs', 'Firestorm Solutions'],
}

// High-priority companies for federal contracts (biggest defense spenders)
const PRIORITY_COMPANIES = [
  'Lockheed Martin', 'Boeing', 'Raytheon', 'Northrop Grumman',
  'General Dynamics', 'L3Harris', 'BAE Systems', 'Leidos',
  'SAIC', 'Booz Allen', 'CACI', 'Palantir', 'Anduril',
  'SpaceX', 'Peraton', 'Parsons', 'KBR', 'ManTech',
  'CrowdStrike', 'Palo Alto Networks', 'Shield AI', 'Scale AI',
  'Maxar', 'Textron', 'Kratos', 'Aerovironment',
  'Sierra Nevada', 'Mercury Systems', 'Curtiss-Wright',
]

const PAGES_PER_COMPANY = 5 // 5 pages × 100 = up to 500 awards per company

interface USASpendingResult {
  'Award ID': string
  'Recipient Name': string
  'Award Amount': number
  'Awarding Agency': string
  'Awarding Sub Agency': string
  'Start Date': string
  'End Date': string
  'Description': string
  'Award Type': string
  'NAICS Code': string
  'Place of Performance State Code': string
  'Place of Performance Country Code': string
}

const apiErrors: string[] = []

async function searchContracts(
  company: string,
  page: number,
  minAmount: number = 100000
): Promise<{ results: USASpendingResult[]; hasMore: boolean }> {
  try {
    const body = {
      filters: {
        recipient_search_text: [company],
        time_period: [{ start_date: '2015-01-01', end_date: '2026-12-31' }],
        award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only (not grants/loans)
        award_amounts: [{ lower_bound: minAmount }],
      },
      fields: [
        'Award ID', 'Recipient Name', 'Award Amount',
        'Awarding Agency', 'Awarding Sub Agency',
        'Start Date', 'End Date', 'Description', 'Award Type',
        'NAICS Code',
        'Place of Performance State Code', 'Place of Performance Country Code',
      ],
      limit: 100,
      page,
      sort: 'Award Amount',
      order: 'desc',
    }
    const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      apiErrors.push(`${company} p${page}: HTTP ${res.status} ${text.slice(0, 100)}`)
      return { results: [], hasMore: false }
    }
    const data = await res.json()
    return {
      results: data.results || [],
      hasMore: data.page_metadata?.hasNext ?? false,
    }
  } catch (err) {
    apiErrors.push(`${company} p${page}: ${err instanceof Error ? err.message : String(err)}`)
    return { results: [], hasMore: false }
  }
}

async function findOrCreateAgency(agencyName: string): Promise<string | null> {
  if (!agencyName) return null
  const slug = agencyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const existing = await prisma.entity.findUnique({ where: { slug } })
  if (existing) return existing.id

  // Look up US country for government agencies
  const usCountry = await prisma.country.findUnique({ where: { alpha2: 'US' } })

  const entity = await prisma.entity.create({
    data: {
      name: agencyName,
      slug,
      type: 'GOVERNMENT',
      description: `U.S. federal agency: ${agencyName}`,
      headquartersCountryId: usCountry?.id || null,
    },
  })
  return entity.id
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request, { allowCronSecret: true })
  if (!admin.ok) return admin.response

  // Optional: ?company=SpaceX to sync just one
  const singleCompany = request.nextUrl.searchParams.get('company')
  const companies = singleCompany ? [singleCompany] : PRIORITY_COMPANIES

  const start = Date.now()
  let totalAdded = 0
  let totalValue = 0
  const log: string[] = []

  for (const companyName of companies) {
    // Find matching entity in DB — use exact slug match first, then name
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    let entity = await prisma.entity.findFirst({
      where: { slug },
    })
    if (!entity) {
      // Try exact name match
      entity = await prisma.entity.findFirst({
        where: { name: companyName },
      })
    }
    if (!entity) {
      // Try starts-with as last resort (avoids "SAIC" matching "Mosaic")
      entity = await prisma.entity.findFirst({
        where: { name: { startsWith: companyName } },
      })
    }

    if (!entity) {
      log.push(`Skip: no entity found for "${companyName}" — run SBIR sync first`)
      continue
    }

    let companyAdded = 0
    const seenAwardIds = new Set<string>()
    const searchTerms = SEARCH_ALIASES[companyName] || [companyName]

    for (const searchTerm of searchTerms) {
      for (let page = 1; page <= PAGES_PER_COMPANY; page++) {
        const { results, hasMore } = await searchContracts(searchTerm, page)

        for (const award of results) {
          if (!award['Award ID']) continue
          if (seenAwardIds.has(award['Award ID'])) continue
          seenAwardIds.add(award['Award ID'])

          // Skip awards we already have (including from SBIR sync)
          const awardId = `FED-USA-${award['Award ID']}`
          const sbirAwardId = `SBIR-USA-${award['Award ID']}`

          const existing = await prisma.contract.findFirst({
            where: { OR: [{ awardId }, { awardId: sbirAwardId }] },
          })
          if (existing) continue

          const agencyName = award['Awarding Sub Agency'] || award['Awarding Agency']
          const agencyId = await findOrCreateAgency(agencyName)

          const awardDate = award['Start Date'] ? new Date(award['Start Date']) : null
          const endDate = award['End Date'] ? new Date(award['End Date']) : null

          await prisma.contract.create({
            data: {
              awardId,
              entityId: entity.id,
              agencyId,
              description: award['Description'] || null,
              value: award['Award Amount'] || null,
              awardDate: awardDate && !isNaN(awardDate.getTime()) ? awardDate : null,
              endDate: endDate && !isNaN(endDate.getTime()) ? endDate : null,
              naicsCode: award['NAICS Code'] || null,
              placeOfPerformance: [
                award['Place of Performance State Code'],
                award['Place of Performance Country Code'],
              ].filter(Boolean).join(', ') || null,
              sources: JSON.stringify([{
                url: `https://www.usaspending.gov/award/${award['Award ID']}`,
                title: `Federal Contract: ${(award['Description'] || '').slice(0, 80)}`,
                domain: 'usaspending.gov',
              }]),
            },
          })
          companyAdded++
          totalValue += award['Award Amount'] || 0
        }

        // Rate limit
        await new Promise((r) => setTimeout(r, 250))
        if (!hasMore) break
      }
    }

    totalAdded += companyAdded
    if (companyAdded > 0) {
      log.push(`${entity.name}: +${companyAdded} federal contracts ($${(totalValue / 1e6).toFixed(1)}M cumulative)`)
    } else {
      log.push(`${entity.name}: 0 new contracts (${seenAwardIds.size} results, all existing or filtered)`)
    }
  }

  return NextResponse.json({
    success: true,
    elapsed: `${((Date.now() - start) / 1000).toFixed(1)}s`,
    companiesSearched: companies.length,
    totalAdded,
    totalValue,
    totalValueFormatted: `$${(totalValue / 1e6).toFixed(1)}M`,
    log,
    apiErrors: apiErrors.slice(0, 20),
  })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
