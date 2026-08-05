import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

/**
 * Driven off SITE_URL like the sitemap, so both follow the domain.
 *
 * The disallow list is not a security control — every path on it is enforced
 * server-side by requireUser/requireAdminRequest. It exists so crawlers do not
 * spend budget on URLs that only ever return a redirect, and so authenticated
 * surfaces stay out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/account',
          '/watchlists',
          '/alerts',
          '/analyst',
          '/signin',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
