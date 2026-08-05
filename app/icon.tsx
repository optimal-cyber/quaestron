import { ImageResponse } from 'next/og'

/**
 * Favicon.
 *
 * The app shipped with the create-next-app default — the Vercel triangle —
 * untouched since the initial scaffold commit. Neither rename PR caught it,
 * because a favicon is a binary blob no text sweep can see. Same reason
 * "IRON ECHELON v1.0" survived in the status bar: nobody looked at the output.
 *
 * The mark is the chevron from the `❮ QUAESTRON` wordmark, DRAWN AS A PATH
 * rather than set as text. The first version used the literal ❮ character and
 * rendered as a tofu box, because Satori's default font has no glyph at U+276E.
 * A path has no font dependency and stays crisp at 16px, where letterforms and
 * interior detail turn to mud.
 */

export const size = { width: 64, height: 64 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0B0F1A',
          // A hairline keeps the mark from dissolving into a dark browser tab.
          border: '3px solid #1E293B',
          borderRadius: 12,
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
          <path
            d="M15 5 L7 12 L15 19"
            stroke="#C8102E"
            strokeWidth="4.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size }
  )
}
