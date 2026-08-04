import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'

/**
 * Lobbying disclosure sync from the Senate Lobbying Disclosure Act (LDA) API.
 * Source: https://lda.senate.gov/api/
 *
 * Shows which defense/surveillance companies are spending money to influence
 * government policy — key transparency data for understanding the
 * military-industrial complex.
 */

const LDA_API_BASE = 'https://lda.senate.gov/api/v1'

// Companies to search lobbying records for
const LOBBYING_COMPANIES = [
  'Lockheed Martin', 'Boeing', 'Raytheon', 'Northrop Grumman',
  'General Dynamics', 'L3Harris', 'BAE Systems', 'Leidos',
  'SAIC', 'Booz Allen Hamilton', 'CACI International', 'Palantir',
  'SpaceX', 'Space Exploration Technologies',
  'Peraton', 'Parsons', 'KBR', 'ManTech',
  'CrowdStrike', 'Palo Alto Networks',
  'Amazon Web Services', 'Microsoft', 'Google',
  'Anduril Industries', 'Shield AI',
  'Maxar Technologies', 'Textron',
  'Elbit Systems of America', 'Thales',
  'Sierra Nevada Corporation',
  'Scale AI', 'Rebellion Defense',
  'Cellebrite', 'Verint', 'NSO Group',
]

// Map registrant names to our entity names for matching
const REGISTRANT_TO_ENTITY: Record<string, string> = {
  'Space Exploration Technologies': 'SpaceX',
  'Space Exploration Technologies Corp': 'SpaceX',
  'Booz Allen Hamilton': 'Booz Allen',
  'Booz Allen Hamilton Inc': 'Booz Allen',
  'CACI International': 'CACI',
  'CACI International Inc': 'CACI',
  'Science Applications International': 'SAIC',
  'ManTech International': 'ManTech',
  'Anduril Industries': 'Anduril',
  'Anduril Industries Inc': 'Anduril',
  'Amazon Web Services': 'Amazon Web Services',
  'Maxar Technologies': 'Maxar',
  'Sierra Nevada Corporation': 'Sierra Nevada',
  'Elbit Systems of America': 'Elbit Systems',
}

interface LDAFiling {
  filing_uuid: string
  filing_type: string
  filing_year: number
  filing_period: string
  registrant: {
    name: string
    id: number
  }
  client: {
    name: string
    id: number
  }
  income?: string | number | null
  expenses?: string | number | null
  lobbying_activities?: Array<{
    general_issue_code: string
    general_issue_code_display: string
    description: string
    government_entities: Array<{ name: string }>
    lobbyists: Array<{
      lobbyist: { first_name: string; last_name: string }
      covered_position: string
    }>
  }>
}

const apiErrors: string[] = []

async function searchFilings(
  companyName: string,
  year: number
): Promise<LDAFiling[]> {
  try {
    const params = new URLSearchParams({
      registrant_name: companyName,
      filing_year: year.toString(),
    })

    const res = await fetch(`${LDA_API_BASE}/filings/?${params}`, {
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) {
      if (res.status === 429) {
        // Rate limited — wait and skip
        apiErrors.push(`${companyName}/${year}: rate limited (429)`)
        return []
      }
      apiErrors.push(`${companyName}/${year}: HTTP ${res.status}`)
      return []
    }

    const data = await res.json()
    return data.results || []
  } catch (err) {
    apiErrors.push(`${companyName}/${year}: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

async function matchEntity(registrantName: string): Promise<string | null> {
  // Try direct name mapping first
  const mappedName = REGISTRANT_TO_ENTITY[registrantName] || registrantName
  const slug = mappedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  const entity = await prisma.entity.findFirst({
    where: {
      OR: [
        { name: { contains: mappedName } },
        { slug: { contains: slug } },
      ],
    },
    select: { id: true },
  })

  return entity?.id || null
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request, { allowCronSecret: true })
  if (!admin.ok) return admin.response

  // Optional: ?company=Palantir or ?year=2024
  const singleCompany = request.nextUrl.searchParams.get('company')
  const yearParam = request.nextUrl.searchParams.get('year')
  const companies = singleCompany ? [singleCompany] : LOBBYING_COMPANIES
  const currentYear = new Date().getFullYear()
  const years = yearParam
    ? [parseInt(yearParam)]
    : [currentYear, currentYear - 1, currentYear - 2] // Last 3 years

  const start = Date.now()
  let totalAdded = 0
  let totalAmount = 0
  const log: string[] = []

  for (const companyName of companies) {
    let companyAdded = 0
    let companyAmount = 0

    for (const year of years) {
      const filings = await searchFilings(companyName, year)

      for (const filing of filings) {
        // Check for existing
        const existing = await prisma.lobbyingFiling.findUnique({
          where: { filingId: filing.filing_uuid },
        })
        if (existing) continue

        const rawAmount = filing.expenses || filing.income || null
        const amount = rawAmount ? parseFloat(String(rawAmount)) : null
        const entityId = await matchEntity(filing.registrant.name)

        // Extract lobbying details
        const issues: string[] = []
        const lobbyists: Array<{ name: string; coveredPosition: string }> = []
        const govEntities: string[] = []
        const specificIssues: string[] = []

        for (const activity of filing.lobbying_activities || []) {
          if (activity.general_issue_code_display) {
            issues.push(activity.general_issue_code_display)
          }
          if (activity.description) {
            specificIssues.push(activity.description)
          }
          for (const ge of activity.government_entities || []) {
            if (ge.name && !govEntities.includes(ge.name)) {
              govEntities.push(ge.name)
            }
          }
          for (const lob of activity.lobbyists || []) {
            lobbyists.push({
              name: `${lob.lobbyist.first_name} ${lob.lobbyist.last_name}`,
              coveredPosition: lob.covered_position || '',
            })
          }
        }

        await prisma.lobbyingFiling.create({
          data: {
            filingId: filing.filing_uuid,
            registrantName: filing.registrant.name,
            clientName: filing.client.name,
            filingType: filing.filing_type,
            filingYear: filing.filing_year,
            filingPeriod: filing.filing_type || filing.filing_period,
            amount,
            issues: JSON.stringify([...new Set(issues)]),
            lobbyists: JSON.stringify(lobbyists),
            governmentEntities: JSON.stringify(govEntities),
            specificIssues: specificIssues.join(' | ').slice(0, 5000) || null,
            entityId,
          },
        })

        companyAdded++
        if (amount) companyAmount += amount
      }

      // Rate limit between requests (Senate LDA API is strict)
      await new Promise((r) => setTimeout(r, 2000))
    }

    totalAdded += companyAdded
    totalAmount += companyAmount
    if (companyAdded > 0) {
      log.push(`${companyName}: +${companyAdded} filings ($${(companyAmount / 1e6).toFixed(2)}M)`)
    }
  }

  return NextResponse.json({
    success: true,
    elapsed: `${((Date.now() - start) / 1000).toFixed(1)}s`,
    companiesSearched: companies.length,
    yearsSearched: years,
    totalAdded,
    totalAmount,
    totalAmountFormatted: `$${(totalAmount / 1e6).toFixed(1)}M`,
    log,
    apiErrors: apiErrors.slice(0, 20),
  })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
