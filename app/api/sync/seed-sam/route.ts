import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'
import { getSamApiKey } from '@/lib/clients/sam'

/**
 * SAM.gov Entity Registration sync.
 * Source: https://api.sam.gov/entity-information/v3/entities
 *
 * Enriches company profiles with:
 * - Physical addresses (enables city-level mapping)
 * - CAGE codes and UEI numbers
 * - NAICS/PSC codes (what they do)
 * - Business types (small business, veteran-owned, etc.)
 * - Congressional districts (who represents them)
 *
 * Requires SAM_GOV_API_KEY environment variable.
 * Get a free key at https://api.sam.gov
 */

const SAM_API_BASE = 'https://api.sam.gov/entity-information/v3/entities'

// Companies to look up in SAM.gov
const SAM_COMPANIES = [
  'Lockheed Martin', 'Boeing', 'Raytheon', 'Northrop Grumman',
  'General Dynamics', 'L3Harris', 'Leidos',
  'SAIC', 'Booz Allen Hamilton', 'CACI International', 'Palantir',
  'SpaceX', 'Space Exploration Technologies',
  'Peraton', 'Parsons', 'KBR', 'ManTech',
  'CrowdStrike', 'Palo Alto Networks',
  'Anduril Industries', 'Shield AI',
  'Maxar Technologies', 'Textron', 'Kratos Defense',
  'Sierra Nevada Corporation', 'Mercury Systems',
  'Scale AI', 'Skydio',
  'Epirus', 'Rebellion Defense', 'Vannevar Labs',
  'Shift5', 'Hawkeye 360', 'Capella Space',
  'BlackSky Technology', 'Planet Labs',
  'Dataminr', 'Babel Street',
  'Aerovironment', 'Joby Aviation', 'Rocket Lab',
  'Fortem Technologies', 'Dedrone', 'DroneShield',
  'BigBear AI', 'C3 AI', 'Applied Intuition',
  'Second Front Systems',
]

// Map SAM names back to our entity names
const SAM_TO_ENTITY: Record<string, string> = {
  'SPACE EXPLORATION TECHNOLOGIES CORP': 'SpaceX',
  'BOOZ ALLEN HAMILTON INC': 'Booz Allen',
  'CACI INTERNATIONAL INC': 'CACI',
  'SCIENCE APPLICATIONS INTERNATIONAL CORPORATION': 'SAIC',
  'MANTECH INTERNATIONAL CORPORATION': 'ManTech',
  'ANDURIL INDUSTRIES INC': 'Anduril',
  'MAXAR TECHNOLOGIES INC': 'Maxar',
  'SIERRA NEVADA CORPORATION': 'Sierra Nevada',
  'BLACKSKY TECHNOLOGY INC': 'BlackSky',
  'PLANET LABS PBC': 'Planet Labs',
  'SECOND FRONT SYSTEMS INC': 'Second Front',
}

interface SamEntity {
  ueiSAM: string
  legalBusinessName: string
  cageCode?: string
  duns?: string
  physicalAddress?: {
    addressLine1: string
    addressLine2?: string
    city: string
    stateOrProvinceCode: string
    zipCode: string
    countryCode: string
  }
  mailingAddress?: {
    addressLine1: string
    city: string
    stateOrProvinceCode: string
    zipCode: string
    countryCode: string
  }
  congressionalDistrict?: string
  naicsCode?: string
  naicsList?: Array<{
    naicsCode: string
    naicsDescription: string
    isPrimary: boolean
  }>
  pscList?: Array<{ pscCode: string; pscDescription: string }>
  businessTypes?: {
    businessTypeList: Array<{
      businessTypeCode: string
      businessTypeDescription: string
    }>
  }
  entityStructure?: string
  stateOfIncorporation?: string
  fiscalYearEndCloseDate?: string
  entityURL?: string
  registrationDate?: string
  registrationExpirationDate?: string
  activeRegistrationStatus?: string
}

const apiErrors: string[] = []

async function searchSam(companyName: string): Promise<SamEntity[]> {
  const apiKey = getSamApiKey()
  if (!apiKey) {
    apiErrors.push('SAM API key not configured (set SAM_GOV_API_KEY or SAM_SECRET)')
    return []
  }

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      legalBusinessName: companyName,
      registrationStatus: 'A', // Active only
      purposeOfRegistrationCode: 'Z2', // Federal contracts
    })

    const res = await fetch(`${SAM_API_BASE}?${params}`)
    if (!res.ok) {
      apiErrors.push(`${companyName}: HTTP ${res.status}`)
      return []
    }

    const data = await res.json()
    return (data.entityData || []).map((e: { entityRegistration: SamEntity; coreData?: { physicalAddress?: SamEntity['physicalAddress']; mailingAddress?: SamEntity['mailingAddress']; congressionalDistrict?: string; entityInformation?: { entityURL?: string; fiscalYearEndCloseDate?: string; entityStructure?: string } }; assertions?: { goodsAndServices?: { naicsList?: SamEntity['naicsList']; pscList?: SamEntity['pscList'] } } }) => ({
      ...e.entityRegistration,
      physicalAddress: e.coreData?.physicalAddress,
      mailingAddress: e.coreData?.mailingAddress,
      congressionalDistrict: e.coreData?.congressionalDistrict,
      naicsList: e.assertions?.goodsAndServices?.naicsList,
      pscList: e.assertions?.goodsAndServices?.pscList,
      entityURL: e.coreData?.entityInformation?.entityURL,
      fiscalYearEndCloseDate: e.coreData?.entityInformation?.fiscalYearEndCloseDate,
      entityStructure: e.coreData?.entityInformation?.entityStructure,
    }))
  } catch (err) {
    apiErrors.push(`${companyName}: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

async function matchEntity(samName: string, searchName: string): Promise<string | null> {
  const mappedName = SAM_TO_ENTITY[samName.toUpperCase()] || searchName
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

  if (!getSamApiKey()) {
    return NextResponse.json({
      error: 'SAM API key not configured (set SAM_GOV_API_KEY or SAM_SECRET). Get a free key at https://api.sam.gov',
    }, { status: 500 })
  }

  const singleCompany = request.nextUrl.searchParams.get('company')
  const companies = singleCompany ? [singleCompany] : SAM_COMPANIES

  const start = Date.now()
  let totalAdded = 0
  let totalEnriched = 0
  const log: string[] = []

  for (const companyName of companies) {
    const results = await searchSam(companyName)

    for (const sam of results) {
      if (!sam.ueiSAM) continue

      const entityId = await matchEntity(sam.legalBusinessName, companyName)

      // Upsert SAM registration
      const existingReg = await prisma.samRegistration.findUnique({
        where: { uei: sam.ueiSAM },
      })

      const naicsCodes = (sam.naicsList || []).map(n => ({
        code: n.naicsCode,
        description: n.naicsDescription,
        primary: n.isPrimary,
      }))
      const pscCodes = (sam.pscList || []).map(p => ({
        code: p.pscCode,
        description: p.pscDescription,
      }))
      const businessTypes = (sam.businessTypes?.businessTypeList || []).map(b => ({
        code: b.businessTypeCode,
        description: b.businessTypeDescription,
      }))

      const regData = {
        entityName: sam.legalBusinessName,
        cageCode: sam.cageCode || null,
        duns: sam.duns || null,
        physicalAddress: sam.physicalAddress ? JSON.stringify(sam.physicalAddress) : null,
        mailingAddress: sam.mailingAddress ? JSON.stringify(sam.mailingAddress) : null,
        congressionalDistrict: sam.congressionalDistrict || null,
        naicsCodes: JSON.stringify(naicsCodes),
        pscCodes: JSON.stringify(pscCodes),
        businessTypes: JSON.stringify(businessTypes),
        entityStructure: sam.entityStructure || null,
        stateOfIncorp: sam.stateOfIncorporation || null,
        fiscalYearEnd: sam.fiscalYearEndCloseDate || null,
        entityUrl: sam.entityURL || null,
        registrationDate: sam.registrationDate ? new Date(sam.registrationDate) : null,
        expirationDate: sam.registrationExpirationDate ? new Date(sam.registrationExpirationDate) : null,
        activeStatus: sam.activeRegistrationStatus || null,
        entityId,
        lastSynced: new Date(),
      }

      if (existingReg) {
        await prisma.samRegistration.update({
          where: { uei: sam.ueiSAM },
          data: regData,
        })
      } else {
        await prisma.samRegistration.create({
          data: { uei: sam.ueiSAM, ...regData },
        })
        totalAdded++
      }

      // Enrich matched entity with CAGE code, UEI, and city
      if (entityId && sam.cageCode) {
        const updates: Record<string, string> = {}
        const entity = await prisma.entity.findUnique({
          where: { id: entityId },
          select: { cageCode: true, uei: true, headquartersCity: true },
        })
        if (entity && !entity.cageCode) updates.cageCode = sam.cageCode
        if (entity && !entity.uei) updates.uei = sam.ueiSAM
        if (entity && !entity.headquartersCity && sam.physicalAddress?.city) {
          updates.headquartersCity = `${sam.physicalAddress.city}, ${sam.physicalAddress.stateOrProvinceCode}`
        }

        if (Object.keys(updates).length > 0) {
          await prisma.entity.update({ where: { id: entityId }, data: updates })
          totalEnriched++
          log.push(`Enriched ${companyName}: ${Object.keys(updates).join(', ')}`)
        }
      }
    }

    if (results.length > 0) {
      log.push(`${companyName}: ${results.length} SAM registrations found`)
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 300))
  }

  return NextResponse.json({
    success: true,
    elapsed: `${((Date.now() - start) / 1000).toFixed(1)}s`,
    companiesSearched: companies.length,
    totalAdded,
    totalEnriched,
    log,
    apiErrors: apiErrors.slice(0, 20),
  })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
