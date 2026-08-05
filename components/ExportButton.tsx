'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'

/**
 * Pro-gated export control.
 *
 * The server is the real gate (`apiRequireTier('PRO')`); this only shapes the
 * affordance so a Free user sees why it's unavailable instead of downloading a
 * 403 JSON body as a file.
 */
export default function ExportButton({
  endpoint,
  params,
  label = 'EXPORT',
}: {
  endpoint: '/api/export/compliance' | '/api/export/contracts' | '/api/export/crosswalk'
  params?: Record<string, string>
  label?: string
}) {
  const { data: session, status } = useSession()
  const [busy, setBusy] = useState<'csv' | 'xlsx' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const tier = session?.user?.tier
  const allowed = tier === 'PRO' || tier === 'TEAM'

  async function download(format: 'csv' | 'xlsx') {
    setBusy(format)
    setError(null)
    try {
      const query = new URLSearchParams({ ...(params ?? {}), format })
      const res = await fetch(`${endpoint}?${query}`)
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setError(json?.error || 'Export failed')
        return
      }

      // Filename comes from Content-Disposition so it matches the server's stamp.
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = match?.[1] || `quaestron-export.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Export failed')
    } finally {
      setBusy(null)
    }
  }

  if (status === 'loading') return null

  if (!session?.user) {
    return (
      <Link
        href="/signin"
        className="px-2 py-1 font-mono text-[10px] tracking-wider rounded border border-border text-muted hover:border-border-bright hover:text-muted-foreground transition-colors"
      >
        {label} (SIGN IN)
      </Link>
    )
  }

  if (!allowed) {
    return (
      <Link
        href="/pricing"
        className="px-2 py-1 font-mono text-[10px] tracking-wider rounded border border-border text-muted hover:border-accent-gold/50 hover:text-accent-gold transition-colors"
        title="Exports are a Pro feature"
      >
        {label} (PRO)
      </Link>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-[10px] text-muted">{label}</span>
      {(['csv', 'xlsx'] as const).map((format) => (
        <button
          key={format}
          onClick={() => download(format)}
          disabled={busy !== null}
          className="px-2 py-1 font-mono text-[10px] tracking-wider rounded border border-accent-green/40 text-accent-green hover:bg-accent-green/10 disabled:opacity-40 transition-colors"
        >
          {busy === format ? '…' : format.toUpperCase()}
        </button>
      ))}
      {error && <span className="font-mono text-[10px] text-accent-red ml-1">{error}</span>}
    </span>
  )
}
