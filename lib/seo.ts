import { prisma } from '@/lib/db'
import { safeJsonArray } from '@/lib/compliance/shared'

/**
 * Metadata helpers for the programmatic landing pages.
 *
 * Descriptions are built from real fields rather than a template with the name
 * substituted in — a page that says "the leading provider of…" about a vendor
 * we hold three data points on is the kind of thing that gets a site
 * classified as thin content, and it would be untrue.
 *
 * Every lookup degrades to null on failure so a database that is mid-migration
 * yields default metadata instead of a 500 on a public URL.
 */

export const SITE_URL = process.env.AUTH_URL?.replace(/\/$/, '') || 'https://intel.ironechelon.com'

export interface VendorSeo {
  name: string
  slug: string
  type: string
  description: string | null
  country: string | null
  businessSize: string | null
  setAsides: string[]
  authorizationCount: number
  highestLevel: string | null
}

export async function vendorSeo(slug: string): Promise<VendorSeo | null> {
  try {
    const entity = await prisma.entity.findFirst({
      where: { OR: [{ slug }, { id: slug }] },
      select: {
        name: true,
        slug: true,
        type: true,
        description: true,
        businessSize: true,
        setAsides: true,
        headquartersCountry: { select: { name: true } },
        fedrampAuths: { select: { impactLevel: true, status: true } },
        dodProvisionalAuths: { select: { impactLevel: true } },
      },
    })
    if (!entity) return null

    const levels = [
      ...entity.fedrampAuths.map((a) => a.impactLevel),
      ...entity.dodProvisionalAuths.map((a) => a.impactLevel),
    ].filter((l): l is string => Boolean(l))

    const { highestLevel } = await import('@/lib/compliance/shared').then((m) => ({
      highestLevel: m.highestLevel(levels),
    }))

    return {
      name: entity.name,
      slug: entity.slug,
      type: entity.type,
      description: entity.description || null,
      country: entity.headquartersCountry?.name ?? null,
      businessSize: entity.businessSize,
      setAsides: safeJsonArray(entity.setAsides),
      authorizationCount: entity.fedrampAuths.length + entity.dodProvisionalAuths.length,
      highestLevel,
    }
  } catch (err) {
    console.error('[seo] vendor lookup failed:', err)
    return null
  }
}

/** One sentence of real facts — no superlatives, no invented positioning. */
export function vendorDescription(seo: VendorSeo): string {
  const parts: string[] = [
    `${seo.name} — federal compliance and contract intelligence.`,
  ]

  if (seo.authorizationCount > 0) {
    parts.push(
      `${seo.authorizationCount} cloud authorization${seo.authorizationCount === 1 ? '' : 's'} on record${seo.highestLevel ? ` (highest: ${seo.highestLevel})` : ''}.`
    )
  } else {
    parts.push('No FedRAMP or DoD cloud authorization on record.')
  }

  if (seo.businessSize === 'SMALL') parts.push('Small business.')
  if (seo.setAsides.length > 0) parts.push(`Set-asides: ${seo.setAsides.join(', ')}.`)
  if (seo.country && seo.country !== 'United States') parts.push(`Headquartered in ${seo.country}.`)

  parts.push('FedRAMP status, DoD impact levels, agency relationships, and federal obligations.')
  return parts.join(' ')
}

export interface CsoSeo {
  packageId: string
  csoName: string
  cspName: string
  status: string
  impactLevel: string | null
  serviceModel: string[]
  sponsoringAgency: string | null
  leveragingAgencies: string[]
  authorizationDate: Date | null
  expirationDate: Date | null
  entity: { name: string; slug: string } | null
}

export async function csoSeo(packageId: string): Promise<CsoSeo | null> {
  try {
    const row = await prisma.fedrampAuthorization.findUnique({
      where: { packageId },
      select: {
        packageId: true,
        csoName: true,
        cspName: true,
        status: true,
        impactLevel: true,
        serviceModel: true,
        sponsoringAgency: true,
        leveragingAgencies: true,
        authorizationDate: true,
        expirationDate: true,
        serviceDescription: true,
        entity: { select: { name: true, slug: true } },
      },
    })
    if (!row) return null

    return {
      packageId: row.packageId,
      csoName: row.csoName,
      cspName: row.cspName,
      status: row.status,
      impactLevel: row.impactLevel,
      serviceModel: safeJsonArray(row.serviceModel),
      sponsoringAgency: row.sponsoringAgency,
      leveragingAgencies: safeJsonArray(row.leveragingAgencies),
      authorizationDate: row.authorizationDate,
      expirationDate: row.expirationDate,
      entity: row.entity,
    }
  } catch (err) {
    console.error('[seo] cso lookup failed:', err)
    return null
  }
}

export function csoDescription(seo: CsoSeo): string {
  const parts = [
    `${seo.csoName} by ${seo.cspName} — FedRAMP ${seo.status}${seo.impactLevel ? ` at ${seo.impactLevel} impact level` : ''}.`,
  ]
  if (seo.sponsoringAgency) parts.push(`Sponsored by ${seo.sponsoringAgency}.`)
  if (seo.leveragingAgencies.length > 0) {
    parts.push(
      `${seo.leveragingAgencies.length} agenc${seo.leveragingAgencies.length === 1 ? 'y' : 'ies'} leveraging this authorization.`
    )
  }
  parts.push('Authorization history, agency reuse, and the vendor’s federal contract record.')
  return parts.join(' ')
}
