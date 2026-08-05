import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Quaestron — Defense Market Intelligence'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0B0F1A 0%, #111827 40%, #0B0F1A 100%)',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle grid overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(200,16,46,0.08) 0%, transparent 70%)',
            display: 'flex',
          }}
        />

        {/* Top accent line */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '3px',
            background: 'linear-gradient(90deg, transparent 0%, #C8102E 30%, #C8102E 70%, transparent 100%)',
            display: 'flex',
          }}
        />

        {/* Bracket */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '24px',
          }}
        >
          <span style={{ color: '#C8102E', fontSize: '28px', fontWeight: 300 }}>&lt;</span>
          <span
            style={{
              fontSize: '16px',
              letterSpacing: '0.35em',
              color: '#C8102E',
              fontWeight: 600,
              textTransform: 'uppercase' as const,
            }}
          >
            QUAESTRON
          </span>
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: '18px',
            letterSpacing: '0.3em',
            color: '#94A3B8',
            fontWeight: 400,
            marginBottom: '16px',
            textTransform: 'uppercase' as const,
            display: 'flex',
          }}
        >
          THEY BUILD THE WEAPONS.
        </div>

        {/* Main headline */}
        <div
          style={{
            fontSize: '52px',
            fontWeight: 700,
            color: '#F1F5F9',
            letterSpacing: '0.05em',
            lineHeight: 1.2,
            textAlign: 'center',
            marginBottom: '8px',
            display: 'flex',
          }}
        >
          IT&apos;S TIME TO MAP
        </div>
        <div
          style={{
            fontSize: '52px',
            fontWeight: 700,
            color: '#C8102E',
            letterSpacing: '0.05em',
            display: 'flex',
          }}
        >
          THE ARSENAL.
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: '16px',
            color: '#64748B',
            maxWidth: '600px',
            textAlign: 'center',
            lineHeight: 1.6,
            marginTop: '32px',
            display: 'flex',
          }}
        >
          Defense tech, cybersecurity, AI, and surveillance ecosystem — companies, investors, contracts, and connections.
        </div>

        {/* Stats bar */}
        <div
          style={{
            display: 'flex',
            gap: '48px',
            marginTop: '40px',
            padding: '16px 32px',
            borderTop: '1px solid rgba(148,163,184,0.15)',
            borderBottom: '1px solid rgba(148,163,184,0.15)',
          }}
        >
          {[
            { num: '1,700+', label: 'ENTITIES' },
            { num: '1,183', label: 'CONNECTIONS' },
            { num: '578', label: 'SBIR AWARDS' },
            { num: '244', label: 'COUNTRIES' },
          ].map((s) => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '22px', fontWeight: 700, color: '#C8102E' }}>{s.num}</span>
              <span style={{ fontSize: '10px', letterSpacing: '0.2em', color: '#64748B' }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* URL */}
        <div
          style={{
            position: 'absolute',
            bottom: '24px',
            fontSize: '13px',
            letterSpacing: '0.15em',
            color: '#475569',
            display: 'flex',
          }}
        >
          quaestron.io
        </div>
      </div>
    ),
    { ...size }
  )
}
