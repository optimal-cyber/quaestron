'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import type { TargetType } from '@/lib/alerts/types'

/**
 * One-click watch toggle for vendor/entity pages.
 *
 * Signed-out users get a link to /signin rather than a dead control, and tier
 * limit errors surface inline — hitting the free-tier cap is the single most
 * likely failure here and it needs to explain itself, not just fail.
 */
export default function WatchButton({
  targetType,
  targetId,
  targetValue,
  label,
  compact = false,
}: {
  targetType: TargetType
  targetId?: string | null
  targetValue?: string | null
  label?: string | null
  compact?: boolean
}) {
  const { status } = useSession()
  const router = useRouter()
  const [watching, setWatching] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const query = new URLSearchParams({ targetType })
  if (targetId) query.set('targetId', targetId)
  if (targetValue) query.set('targetValue', targetValue)

  const queryString = query.toString()

  useEffect(() => {
    if (status !== 'authenticated') {
      setWatching(null)
      return
    }
    let cancelled = false
    fetch(`/api/watchlists/watch?${queryString}`)
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled && res?.data) setWatching(Boolean(res.data.watching))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [status, queryString])

  const toggle = useCallback(async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const res = watching
        ? await fetch(`/api/watchlists/watch?${queryString}`, { method: 'DELETE' })
        : await fetch('/api/watchlists/watch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetType, targetId, targetValue, label }),
          })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error || 'Could not update watchlist')
        return
      }
      setWatching(Boolean(json?.data?.watching))
    } catch {
      setError('Network error')
    } finally {
      setPending(false)
    }
  }, [pending, watching, queryString, targetType, targetId, targetValue, label])

  const base = compact
    ? 'px-2 py-1 text-[10px]'
    : 'px-3 py-1.5 text-xs'

  if (status === 'loading') {
    return <div className={`${base} invisible font-mono`}>WATCH</div>
  }

  if (status !== 'authenticated') {
    return (
      <button
        onClick={() => router.push('/signin?callbackUrl=' + encodeURIComponent(window.location.pathname))}
        className={`${base} font-mono tracking-wider rounded border border-border text-muted hover:border-border-bright hover:text-muted-foreground transition-colors`}
        title="Sign in to track this in a watchlist"
      >
        + WATCH
      </button>
    )
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        onClick={toggle}
        disabled={pending || watching === null}
        className={`${base} font-mono tracking-wider rounded border transition-colors disabled:opacity-50 ${
          watching
            ? 'border-accent-green/40 text-accent-green hover:bg-accent-green/10'
            : 'border-accent-red/40 text-accent-red hover:bg-accent-red/10'
        }`}
      >
        {pending ? '…' : watching ? '✓ WATCHING' : '+ WATCH'}
      </button>
      {error && (
        <span className="font-mono text-[10px] text-accent-gold max-w-[240px] leading-snug">
          {error}
        </span>
      )}
    </div>
  )
}
