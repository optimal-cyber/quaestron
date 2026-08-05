import { ImageResponse } from 'next/og'
import { vendorSeo } from '@/lib/seo'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Iron Echelon vendor profile'

/**
 * Per-vendor OG card.
 *
 * Renders real figures — authorization count and highest impact level — rather
 * than a name on a template, so a shared link previews something informative.
 * Falls back to a plain branded card if the lookup fails, since an OG route
 * that throws leaves social crawlers with a broken image.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const seo = await vendorSeo(slug).catch(() => null)

  const name = seo?.name ?? 'Iron Echelon'
  const stats: { label: string; value: string }[] = seo
    ? [
        { label: 'AUTHORIZATIONS', value: String(seo.authorizationCount) },
        { label: 'HIGHEST LEVEL', value: seo.highestLevel ?? '—' },
        { label: 'TYPE', value: seo.type.replace(/_/g, ' ') },
      ]
    : []

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0B0F1A',
          padding: 72,
          fontFamily: 'monospace',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ color: '#C8102E', fontSize: 26, letterSpacing: 6 }}>
            &#x276E; IRON ECHELON
          </div>
          <div
            style={{
              color: '#E2E8F0',
              fontSize: name.length > 28 ? 62 : 82,
              marginTop: 28,
              lineHeight: 1.1,
            }}
          >
            {name}
          </div>
          {seo?.country && (
            <div style={{ color: '#64748B', fontSize: 26, marginTop: 16 }}>{seo.country}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 64 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ color: '#B8953E', fontSize: 44 }}>{s.value}</div>
              <div style={{ color: '#64748B', fontSize: 18, letterSpacing: 3, marginTop: 8 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        <div style={{ color: '#64748B', fontSize: 20, letterSpacing: 2 }}>
          FEDRAMP · DOD IMPACT LEVELS · FEDERAL CONTRACTS
        </div>
      </div>
    ),
    size
  )
}
