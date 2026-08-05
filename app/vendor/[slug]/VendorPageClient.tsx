'use client'

import { useEffect, useState } from 'react'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import SearchCommand from '@/components/layout/SearchCommand'
import VendorDossier from '@/components/panels/VendorDossier'
import type { VendorDossier as Dossier } from '@/lib/vendor/build-dossier'

/**
 * Client half of the vendor page. Kept client-side because an unknown vendor is
 * built on demand — the dossier request can take tens of seconds and streams in
 * progressively, which a server render would block on. The server half
 * (page.tsx) owns metadata, OG image, and ISR.
 */
export default function VendorPageClient({ slug }: { slug: string }) {
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    setState('loading')
    // On-demand build of a brand-new vendor passes ?name= from the directory.
    const name = new URLSearchParams(window.location.search).get('name')
    const url = `/api/vendor/${slug}${name ? `?name=${encodeURIComponent(name)}` : ''}`
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: Dossier) => { if (!cancelled) { setDossier(d); setState('ready') } })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [slug])

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav onSearchOpen={() => setSearchOpen(true)} />
      <SearchCommand />

      <div className="flex-1 pt-12 pb-7 bg-background overflow-y-auto">
        {state === 'loading' && (
          <div className="max-w-5xl mx-auto p-8 space-y-4">
            <div className="h-9 w-72 bg-surface rounded animate-pulse" />
            <div className="text-xs font-mono text-muted">Compiling vendor dossier — pulling SAM, USAspending, FedRAMP, SBIR…</div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 bg-surface/50 border border-border rounded-lg animate-pulse" />
            ))}
          </div>
        )}
        {state === 'error' && (
          <div className="max-w-5xl mx-auto p-8 text-center">
            <div className="font-mono text-sm text-accent-red mb-2">VENDOR NOT FOUND</div>
            <p className="text-xs text-muted font-mono">
              No dossier could be built for “{slug}”. Try searching by the vendor’s legal name.
            </p>
          </div>
        )}
        {state === 'ready' && dossier && <VendorDossier d={dossier} />}
      </div>

      <BottomBar />
    </div>
  )
}
