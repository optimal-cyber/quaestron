import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'

// USAspending uses legal entity names, not trade names
// Map our display names to search terms for the API
const SEARCH_ALIASES: Record<string, string[]> = {
  'SpaceX': ['Space Exploration Technologies'],
  'Raytheon': ['Raytheon', 'RTX'],
  'RTX': ['RTX', 'Raytheon'],
  'Booz Allen': ['Booz Allen Hamilton'],
  'CACI': ['CACI International', 'CACI Inc'],
  'SAIC': ['Science Applications International', 'SAIC'],
  'ManTech': ['ManTech International', 'ManTech'],
  'Shield AI': ['Shield AI'],
  'Firestorm': ['Firestorm Labs', 'Firestorm Solutions'],
  'Scale AI': ['Scale AI', 'Scale.AI'],
  'Primer AI': ['Primer Federal', 'Primer Inc'],
  'Planet Labs': ['Planet Labs PBC', 'Planet Federal'],
  'Hawkeye 360': ['HawkEye 360'],
  'Leonardo DRS': ['DRS Defense Solutions', 'Leonardo DRS'],
  'Aerojet Rocketdyne': ['Aerojet Rocketdyne', 'L3Harris Aerojet'],
  'BigBear AI': ['BigBear.ai', 'BigBear AI'],
  'C3 AI': ['C3.ai', 'C3 AI Federal'],
  'Joby Aviation': ['Joby Aviation', 'Joby Aero'],
  'Rebellion Defense': ['Rebellion Defense'],
  'Vannevar Labs': ['Vannevar Labs'],
  'Applied Intuition': ['Applied Intuition'],
  'Second Front': ['Second Front Systems'],
}

// Company name → entity type for auto-creation
const COMPANY_TYPE: Record<string, string> = {
  // Defense tech startups
  'Anduril': 'DEFENSE_PRIME', 'Shield AI': 'AI_ML', 'Skydio': 'SURVEILLANCE',
  'Epirus': 'DEFENSE_PRIME', 'Scale AI': 'AI_ML', 'SpaceX': 'DEFENSE_PRIME',
  'Firestorm': 'DEFENSE_PRIME', 'Rebellion Defense': 'AI_ML',
  'Vannevar Labs': 'AI_ML', 'Primer AI': 'AI_ML', 'Rhombus Power': 'AI_ML',
  'Shift5': 'CYBER_INTEL', 'Hawkeye 360': 'SURVEILLANCE', 'Capella Space': 'SURVEILLANCE',
  'BlackSky': 'SURVEILLANCE', 'Planet Labs': 'SURVEILLANCE',
  'Babel Street': 'SURVEILLANCE', 'Clearview AI': 'SURVEILLANCE',
  'Dataminr': 'AI_ML', 'Voyager Labs': 'SURVEILLANCE',
  // Defense primes
  'Palantir': 'AI_ML', 'L3Harris': 'DEFENSE_PRIME', 'Leidos': 'DEFENSE_PRIME',
  'SAIC': 'DEFENSE_PRIME', 'Booz Allen': 'CONSULTANCY', 'CACI': 'DEFENSE_PRIME',
  'Raytheon': 'DEFENSE_PRIME', 'RTX': 'DEFENSE_PRIME',
  'Northrop Grumman': 'DEFENSE_PRIME', 'Lockheed Martin': 'DEFENSE_PRIME',
  'BAE Systems': 'DEFENSE_PRIME', 'General Dynamics': 'DEFENSE_PRIME',
  'Boeing': 'DEFENSE_PRIME', 'ManTech': 'DEFENSE_PRIME',
  'Textron': 'DEFENSE_PRIME', 'Elbit Systems': 'DEFENSE_PRIME',
  'Thales': 'DEFENSE_PRIME', 'Leonardo DRS': 'DEFENSE_PRIME',
  'Mercury Systems': 'DEFENSE_PRIME', 'Curtiss-Wright': 'DEFENSE_PRIME',
  'Kratos': 'DEFENSE_PRIME',
  // Cyber & surveillance
  'CrowdStrike': 'CYBER_INTEL', 'Palo Alto Networks': 'CYBER_INTEL',
  'Fortinet': 'CYBER_INTEL', 'SentinelOne': 'CYBER_INTEL',
  'Recorded Future': 'CYBER_INTEL', 'Mandiant': 'CYBER_INTEL',
  'Cellebrite': 'CYBER_INTEL', 'Verint': 'SURVEILLANCE',
  'Cobham': 'DEFENSE_PRIME', 'Sierra Nevada': 'DEFENSE_PRIME',
  'Dynetics': 'DEFENSE_PRIME', 'Aerojet Rocketdyne': 'DEFENSE_PRIME',
  // More defense/dual-use
  'Peraton': 'DEFENSE_PRIME', 'Parsons': 'DEFENSE_PRIME',
  'KBR': 'DEFENSE_PRIME', 'Maxar': 'SURVEILLANCE',
  'Aerovironment': 'DEFENSE_PRIME', 'Joby Aviation': 'DEFENSE_PRIME',
  'Rocket Lab': 'DEFENSE_PRIME', 'Hermeus': 'DEFENSE_PRIME',
  'Hadrian': 'DEFENSE_PRIME', 'Fortem Technologies': 'DEFENSE_PRIME',
  // AI/ML and data
  'C3 AI': 'AI_ML', 'BigBear AI': 'AI_ML', 'Dedrone': 'SURVEILLANCE',
  'DroneShield': 'DEFENSE_PRIME', 'Govini': 'AI_ML',
  'Two Six Technologies': 'CYBER_INTEL', 'Applied Intuition': 'AI_ML',
  'Istari': 'AI_ML', 'Second Front': 'DEFENSE_PRIME',
}

const COMPANY_BATCHES: string[][] = [
  // Batch 0: High-profile defense tech startups
  [
    'Anduril', 'Shield AI', 'Skydio', 'Epirus', 'Scale AI',
    'SpaceX', 'Firestorm', 'Rebellion Defense',
    'Vannevar Labs', 'Primer AI', 'Rhombus Power', 'Shift5',
    'Hawkeye 360', 'Capella Space', 'BlackSky', 'Planet Labs',
    'Babel Street', 'Clearview AI', 'Dataminr', 'Voyager Labs',
  ],
  // Batch 1: Defense primes & large contractors
  [
    'Palantir', 'L3Harris', 'Leidos', 'SAIC', 'Booz Allen',
    'CACI', 'Raytheon', 'RTX', 'Northrop Grumman', 'Lockheed Martin',
    'BAE Systems', 'General Dynamics', 'Boeing', 'ManTech',
    'Textron', 'Elbit Systems', 'Thales', 'Leonardo DRS',
    'Mercury Systems', 'Curtiss-Wright', 'Kratos',
  ],
  // Batch 2: Cyber, AI, and surveillance tech
  [
    'CrowdStrike', 'Palo Alto Networks', 'Fortinet', 'SentinelOne',
    'Recorded Future', 'Mandiant', 'Cellebrite', 'Verint',
    'Cobham', 'Sierra Nevada', 'Dynetics', 'Aerojet Rocketdyne',
  ],
  // Batch 3: More defense/dual-use tech
  [
    'Peraton', 'Parsons', 'KBR', 'Maxar',
    'Aerovironment', 'Joby Aviation', 'Rocket Lab', 'Hermeus',
    'Hadrian', 'Fortem Technologies',
  ],
  // Batch 4: AI/ML and data companies
  [
    'C3 AI', 'BigBear AI', 'Applied Intuition',
    'Dedrone', 'DroneShield', 'Govini',
    'Two Six Technologies', 'Istari', 'Second Front',
  ],
]

// Company HQ country (alpha2 code) — defaults to US if not listed
const COMPANY_COUNTRY: Record<string, string> = {
  'BAE Systems': 'GB',
  'Thales': 'FR',
  'Elbit Systems': 'IL',
  'Cellebrite': 'IL',
  'Cobham': 'GB',
  'Leonardo DRS': 'IT',
  'DroneShield': 'AU',
}

const ALL_COMPANIES = COMPANY_BATCHES.flat()
const KEYWORDS = ['SBIR', 'STTR']
const PAGES_PER_SEARCH = 3  // 3 pages × 100 results = up to 300 per company/keyword

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
}

function parsePhase(description: string): string | null {
  if (!description) return null
  const upper = description.toUpperCase()
  if (/PHASE\s*(III|3)\b/.test(upper)) return 'III'
  if (/PHASE\s*(II|2)\b/.test(upper) && !/PHASE\s*(III|3)/.test(upper)) return 'II'
  if (/PHASE\s*(I|1)\b/.test(upper) && !/PHASE\s*(II|2|III|3)/.test(upper)) return 'I'
  return null
}

function parseProgram(description: string, keyword: string): string {
  if (!description) return keyword
  const upper = description.toUpperCase()
  if (upper.includes('STTR')) return 'STTR'
  return 'SBIR'
}

const apiErrors: string[] = []

async function searchSbirPage(company: string, keyword: string, page: number): Promise<{ results: USASpendingResult[], hasMore: boolean }> {
  try {
    const body = {
      filters: {
        keywords: [keyword],
        recipient_search_text: [company],
        time_period: [{ start_date: '2007-10-01', end_date: '2026-12-31' }],
        award_type_codes: ['A', 'B', 'C', 'D'],
      },
      fields: [
        'Award ID', 'Recipient Name', 'Award Amount',
        'Awarding Agency', 'Awarding Sub Agency',
        'Start Date', 'End Date', 'Description', 'Award Type',
      ],
      limit: 50,
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
      apiErrors.push(`${company}/${keyword} p${page}: HTTP ${res.status} ${text.slice(0, 100)}`)
      return { results: [], hasMore: false }
    }
    const data = await res.json()
    return {
      results: data.results || [],
      hasMore: data.page_metadata?.hasNext ?? false,
    }
  } catch (err) {
    apiErrors.push(`${company}/${keyword} p${page}: ${err instanceof Error ? err.message : String(err)}`)
    return { results: [], hasMore: false }
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

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request, { allowCronSecret: true })
  if (!admin.ok) return admin.response

  // Support batching: ?batch=0 through ?batch=4, or omit for all
  const batchParam = request.nextUrl.searchParams.get('batch')
  let companies: string[]
  if (batchParam !== null) {
    const batchIdx = parseInt(batchParam)
    if (isNaN(batchIdx) || batchIdx < 0 || batchIdx >= COMPANY_BATCHES.length) {
      return NextResponse.json({ error: `Invalid batch. Use 0-${COMPANY_BATCHES.length - 1}` }, { status: 400 })
    }
    companies = COMPANY_BATCHES[batchIdx]
  } else {
    companies = ALL_COMPANIES
  }

  const start = Date.now()
  let totalAdded = 0
  let totalValue = 0
  const log: string[] = []

  for (const companyName of companies) {
    // Find matching entity in DB, or create one — use exact match to avoid fuzzy mismatches
    const searchSlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    let entity = await prisma.entity.findFirst({
      where: { slug: searchSlug },
    })
    if (!entity) {
      entity = await prisma.entity.findFirst({
        where: { name: companyName },
      })
    }

    if (!entity) {
      // Auto-create entity for known SBIR companies
      const entityType = COMPANY_TYPE[companyName] || 'DEFENSE_PRIME'
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

      // Look up HQ country (default to US for SBIR recipients)
      const countryAlpha2 = COMPANY_COUNTRY[companyName] || 'US'
      const country = await prisma.country.findUnique({ where: { alpha2: countryAlpha2 } })

      try {
        entity = await prisma.entity.create({
          data: {
            name: companyName,
            slug,
            type: entityType,
            description: `${companyName} — SBIR/STTR award recipient`,
            headquartersCountryId: country?.id || null,
          },
        })
        log.push(`Created entity: ${companyName} (${entityType}, HQ: ${countryAlpha2})`)
      } catch {
        log.push(`Skip: could not create entity for "${companyName}"`)
        continue
      }
    }

    // Backfill country if entity exists but has no HQ set
    if (!entity.headquartersCountryId) {
      const countryAlpha2 = COMPANY_COUNTRY[companyName] || 'US'
      const country = await prisma.country.findUnique({ where: { alpha2: countryAlpha2 } })
      if (country) {
        await prisma.entity.update({
          where: { id: entity.id },
          data: { headquartersCountryId: country.id },
        })
        entity = { ...entity, headquartersCountryId: country.id }
        log.push(`Backfilled HQ country for ${entity.name}: ${countryAlpha2}`)
      }
    }

    let companyAdded = 0
    const seenAwardIds = new Set<string>()

    // Use aliases for USAspending search (legal names vs trade names)
    const searchTerms = SEARCH_ALIASES[companyName] || [companyName]

    for (const searchTerm of searchTerms) {
      for (const keyword of KEYWORDS) {
        for (let page = 1; page <= PAGES_PER_SEARCH; page++) {
          const { results, hasMore } = await searchSbirPage(searchTerm, keyword, page)

          for (const award of results) {
            if (!award['Award ID']) continue
            if (seenAwardIds.has(award['Award ID'])) continue
            seenAwardIds.add(award['Award ID'])

            // Verify the description actually mentions SBIR/STTR
            const desc = (award['Description'] || '').toUpperCase()
            if (!desc.includes('SBIR') && !desc.includes('STTR')) continue

            const awardId = `SBIR-USA-${award['Award ID']}`

            const existing = await prisma.contract.findUnique({ where: { awardId } })
            if (existing) continue

            const agencyName = award['Awarding Sub Agency'] || award['Awarding Agency']
            const agencyId = await findOrCreateAgency(agencyName)

            const awardDate = award['Start Date'] ? new Date(award['Start Date']) : null
            const endDate = award['End Date'] ? new Date(award['End Date']) : null
            const phase = parsePhase(award['Description'] || '')
            const program = parseProgram(award['Description'] || '', keyword)
            const year = awardDate && !isNaN(awardDate.getTime()) ? awardDate.getFullYear() : null

            await prisma.contract.create({
              data: {
                awardId,
                entityId: entity.id,
                agencyId,
                description: award['Description'] || null,
                value: award['Award Amount'] || null,
                awardDate: awardDate && !isNaN(awardDate.getTime()) ? awardDate : null,
                endDate: endDate && !isNaN(endDate.getTime()) ? endDate : null,
                sbirProgram: program,
                sbirPhase: phase,
                sbirAgency: award['Awarding Agency'] || null,
                sbirBranch: agencyName || null,
                sbirAwardYear: year,
                sources: JSON.stringify([{
                  url: `https://www.usaspending.gov/award/${award['Award ID']}`,
                  title: `${program} Award: ${(award['Description'] || '').slice(0, 80)}`,
                  domain: 'usaspending.gov',
                }]),
              },
            })
            companyAdded++
            totalValue += award['Award Amount'] || 0
          }

          // Rate limit between API calls
          await new Promise((r) => setTimeout(r, 200))

          if (!hasMore) break
        }
      }
    }

    totalAdded += companyAdded
    if (companyAdded > 0) {
      log.push(`${entity.name}: +${companyAdded} SBIR/STTR awards`)
    } else if (seenAwardIds.size > 0) {
      log.push(`${entity.name}: ${seenAwardIds.size} results found, 0 new (all existing or filtered)`)
    } else {
      log.push(`${entity.name}: 0 results from USAspending (searched: ${searchTerms.join(', ')})`)
    }
  }

  return NextResponse.json({
    success: true,
    elapsed: `${((Date.now() - start) / 1000).toFixed(1)}s`,
    batch: batchParam !== null ? parseInt(batchParam) : 'all',
    totalBatches: COMPANY_BATCHES.length,
    companiesSearched: companies.length,
    totalAdded,
    totalValue,
    log,
    apiErrors: apiErrors.slice(0, 20),
  })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
