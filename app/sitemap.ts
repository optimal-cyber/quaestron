import type { MetadataRoute } from 'next'
import { prisma } from '@/lib/db'
import { SITE_URL } from '@/lib/seo'

/**
 * Sitemap, driven off SITE_URL so it follows the domain rather than hardcoding it.
 *
 * Regenerated daily. The vendor and CSO sets are the two large enumerable
 * collections and the reason this file exists at all — without it those pages
 * are reachable only by crawling the listing pages, which are client-rendered.
 *
 * Authenticated surfaces (/account, /watchlists, /alerts, /analyst, /admin,
 * /signin) are deliberately absent: they are excluded in robots.ts and listing
 * them here would advertise URLs that only ever return a redirect to a crawler.
 */

export const revalidate = 86_400

/** Cap per collection. Google's limit is 50k URLs per sitemap file. */
const MAX_URLS_PER_COLLECTION = 20_000

const STATIC_ROUTES: Array<{
  path: string
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']
  priority: number
}> = [
  { path: '', changeFrequency: 'daily', priority: 1.0 },
  { path: '/vendors', changeFrequency: 'daily', priority: 0.9 },
  { path: '/compliance', changeFrequency: 'daily', priority: 0.9 },
  { path: '/ato', changeFrequency: 'daily', priority: 0.8 },
  { path: '/contracts', changeFrequency: 'daily', priority: 0.8 },
  { path: '/data', changeFrequency: 'daily', priority: 0.7 },
  { path: '/map', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/network', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/funders', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/intel', changeFrequency: 'hourly', priority: 0.6 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/submit', changeFrequency: 'monthly', priority: 0.4 },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }))

  // A database hiccup must not fail the build or serve an empty sitemap that
  // tells a crawler the site has twelve pages. Degrade to the static set, which
  // is still correct, just smaller.
  const [vendors, csos] = await Promise.all([
    prisma.entity
      .findMany({
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: MAX_URLS_PER_COLLECTION,
      })
      .catch((err: unknown) => {
        console.error('[sitemap] vendor enumeration failed:', err)
        return [] as Array<{ slug: string; updatedAt: Date }>
      }),
    prisma.fedrampAuthorization
      .findMany({
        select: { packageId: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: MAX_URLS_PER_COLLECTION,
      })
      .catch((err: unknown) => {
        console.error('[sitemap] CSO enumeration failed:', err)
        return [] as Array<{ packageId: string; updatedAt: Date }>
      }),
  ])

  for (const v of vendors) {
    if (!v.slug) continue
    entries.push({
      url: `${SITE_URL}/vendor/${encodeURIComponent(v.slug)}`,
      lastModified: v.updatedAt ?? now,
      changeFrequency: 'weekly',
      priority: 0.8,
    })
  }

  for (const c of csos) {
    if (!c.packageId) continue
    entries.push({
      url: `${SITE_URL}/compliance/cso/${encodeURIComponent(c.packageId)}`,
      lastModified: c.updatedAt ?? now,
      changeFrequency: 'weekly',
      priority: 0.7,
    })
  }

  return entries
}
