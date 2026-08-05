import type { Metadata } from 'next'
import { SITE_URL, vendorDescription, vendorSeo } from '@/lib/seo'
import VendorPageClient from './VendorPageClient'

/**
 * Server half of the vendor page: metadata, canonical URL, and revalidation.
 *
 * Revalidated daily. The page shell is what gets cached — the dossier itself is
 * fetched client-side, so an on-demand vendor build is unaffected by the cache
 * and a stale shell never serves stale compliance data.
 */
export const revalidate = 86400

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const seo = await vendorSeo(slug)

  // An unknown slug may still be built on demand, so this stays indexable-neutral
  // rather than asserting a vendor that might not exist.
  if (!seo) {
    return {
      title: 'Vendor — Quaestron',
      description: 'Federal compliance and contract intelligence for defense technology vendors.',
      robots: { index: false, follow: true },
    }
  }

  const title = `${seo.name} — Compliance & Federal Contracts | Quaestron`
  const description = vendorDescription(seo)
  const url = `${SITE_URL}/vendor/${seo.slug}`

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: 'Quaestron',
      type: 'profile',
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function VendorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <VendorPageClient slug={slug} />
}
