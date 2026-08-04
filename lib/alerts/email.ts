import { Resend } from 'resend'

/**
 * Digest email rendering + delivery.
 *
 * The template is hand-written inline-CSS HTML rather than a component library:
 * mail clients strip <style> blocks and have no CSS variable support, so the
 * site's terminal palette is duplicated here as literals.
 */

const PALETTE = {
  background: '#0B0F1A',
  surface: '#111827',
  border: '#1E293B',
  foreground: '#E2E8F0',
  muted: '#64748B',
  mutedForeground: '#94A3B8',
  red: '#C8102E',
  gold: '#B8953E',
  green: '#2ECC71',
} as const

const MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace"

export interface DigestEvent {
  id: string
  ruleType: string
  title: string
  body: string
  url: string | null
  createdAt: Date
}

export interface DigestPayload {
  to: string
  cadence: 'DAILY' | 'WEEKLY'
  events: DigestEvent[]
  siteUrl: string
}

const RULE_ACCENT: Record<string, string> = {
  NEW_CONTRACT: PALETTE.green,
  NEW_SBIR_AWARD: PALETTE.green,
  FEDRAMP_STATUS_CHANGE: PALETTE.gold,
  ATO_EXPIRING: PALETTE.red,
  RISK_FLAG_ADDED: PALETTE.red,
  NEWS_MENTION: PALETTE.mutedForeground,
}

const RULE_LABEL: Record<string, string> = {
  NEW_CONTRACT: 'NEW CONTRACT',
  NEW_SBIR_AWARD: 'SBIR AWARD',
  FEDRAMP_STATUS_CHANGE: 'FEDRAMP CHANGE',
  ATO_EXPIRING: 'ATO EXPIRING',
  RISK_FLAG_ADDED: 'RISK FLAG',
  NEWS_MENTION: 'NEWS',
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Relative paths need the site origin to be clickable in a mail client. */
function absolute(url: string | null, siteUrl: string): string | null {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${siteUrl.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`
}

export function renderDigestHtml(payload: DigestPayload): string {
  const { events, cadence, siteUrl } = payload
  const heading = cadence === 'DAILY' ? 'DAILY INTELLIGENCE DIGEST' : 'WEEKLY INTELLIGENCE DIGEST'

  const rows = events
    .map((e) => {
      const accent = RULE_ACCENT[e.ruleType] || PALETTE.mutedForeground
      const label = RULE_LABEL[e.ruleType] || e.ruleType
      const href = absolute(e.url, siteUrl)
      const bodyLines = e.body
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            `<div style="color:${PALETTE.mutedForeground};font-size:12px;line-height:1.6;">${escapeHtml(line)}</div>`
        )
        .join('')

      return `
        <tr>
          <td style="padding:0 0 12px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                   style="background:${PALETTE.surface};border:1px solid ${PALETTE.border};border-left:3px solid ${accent};border-radius:4px;">
              <tr>
                <td style="padding:14px 16px;">
                  <div style="font-family:${MONO};font-size:10px;letter-spacing:.18em;color:${accent};margin-bottom:6px;">${label}</div>
                  <div style="font-family:${MONO};font-size:14px;color:${PALETTE.foreground};line-height:1.5;margin-bottom:8px;">${escapeHtml(e.title)}</div>
                  <div style="font-family:${MONO};">${bodyLines}</div>
                  ${
                    href
                      ? `<div style="margin-top:10px;"><a href="${escapeHtml(href)}" style="font-family:${MONO};font-size:11px;letter-spacing:.14em;color:${PALETTE.red};text-decoration:none;">OPEN &rsaquo;</a></div>`
                      : ''
                  }
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    })
    .join('')

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PALETTE.background};">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${PALETTE.background};padding:24px 12px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:620px;">
          <tr>
            <td style="padding-bottom:20px;border-bottom:1px solid ${PALETTE.border};">
              <div style="font-family:${MONO};font-size:13px;letter-spacing:.2em;color:${PALETTE.red};font-weight:bold;">&#x276E; IRON ECHELON</div>
              <div style="font-family:${MONO};font-size:10px;letter-spacing:.28em;color:${PALETTE.muted};margin-top:6px;">${heading}</div>
              <div style="font-family:${MONO};font-size:11px;color:${PALETTE.mutedForeground};margin-top:10px;">
                ${events.length} ${events.length === 1 ? 'signal' : 'signals'} since your last digest.
              </div>
            </td>
          </tr>
          <tr><td style="height:20px;"></td></tr>
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows}</table>
            </td>
          </tr>
          <tr>
            <td style="padding-top:16px;border-top:1px solid ${PALETTE.border};">
              <div style="font-family:${MONO};font-size:10px;color:${PALETTE.muted};line-height:1.8;">
                <a href="${siteUrl}/alerts" style="color:${PALETTE.mutedForeground};text-decoration:none;">VIEW ALL ALERTS</a>
                &nbsp;&middot;&nbsp;
                <a href="${siteUrl}/watchlists" style="color:${PALETTE.mutedForeground};text-decoration:none;">MANAGE WATCHLISTS</a>
                &nbsp;&middot;&nbsp;
                <a href="${siteUrl}/account" style="color:${PALETTE.mutedForeground};text-decoration:none;">UNSUBSCRIBE</a>
              </div>
              <div style="font-family:${MONO};font-size:10px;color:${PALETTE.muted};margin-top:10px;">
                Generated by Iron Echelon &middot; intel.ironechelon.com
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function renderDigestText(payload: DigestPayload): string {
  const lines = [
    `IRON ECHELON — ${payload.cadence === 'DAILY' ? 'DAILY' : 'WEEKLY'} INTELLIGENCE DIGEST`,
    `${payload.events.length} signal(s) since your last digest.`,
    '',
  ]
  for (const e of payload.events) {
    lines.push(`[${RULE_LABEL[e.ruleType] || e.ruleType}] ${e.title}`)
    for (const line of e.body.split('\n').filter(Boolean)) lines.push(`  ${line}`)
    const href = absolute(e.url, payload.siteUrl)
    if (href) lines.push(`  ${href}`)
    lines.push('')
  }
  lines.push(`View all: ${payload.siteUrl}/alerts`)
  return lines.join('\n')
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export interface SendResult {
  sent: boolean
  skipped?: string
  error?: string
}

export async function sendDigest(payload: DigestPayload): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, skipped: 'RESEND_API_KEY not configured' }
  }
  if (payload.events.length === 0) {
    return { sent: false, skipped: 'no events' }
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const subject =
    payload.events.length === 1
      ? `[Iron Echelon] ${payload.events[0].title.slice(0, 120)}`
      : `[Iron Echelon] ${payload.events.length} new signals`

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Iron Echelon <intel@ironechelon.com>',
      to: payload.to,
      subject,
      html: renderDigestHtml(payload),
      text: renderDigestText(payload),
    })
    if (error) return { sent: false, error: error.message }
    return { sent: true }
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) }
  }
}
