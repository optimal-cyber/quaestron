'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

/** Nav entry for the alert inbox, with an unread count. Renders nothing when
 *  signed out so the nav stays clean for anonymous browsing. */
export default function AlertsBadge({ mobile = false }: { mobile?: boolean }) {
  const { status } = useSession()
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false

    const load = () =>
      fetch('/api/alerts/unread')
        .then((r) => r.json())
        .then((res) => {
          if (!cancelled && res?.data) setUnread(res.data.unreadCount ?? 0)
        })
        .catch(() => {})

    load()
    // Alerts only materialize when a cron runs, so a slow poll is plenty.
    const timer = setInterval(load, 120_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [status, pathname])

  if (status !== 'authenticated') return null

  const isActive = pathname === '/alerts'

  if (mobile) {
    return (
      <Link
        href="/alerts"
        className={`px-4 py-3 text-sm font-mono tracking-wider rounded transition-colors ${
          isActive ? 'text-accent-red bg-accent-red/10' : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
        }`}
      >
        ALERTS
        {unread > 0 && <span className="ml-2 text-accent-red">({unread})</span>}
      </Link>
    )
  }

  return (
    <Link
      href="/alerts"
      className={`relative flex items-center px-3 py-1.5 text-xs font-mono tracking-wider rounded border transition-colors ${
        isActive
          ? 'text-accent-red border-accent-red/50 bg-accent-red/10'
          : 'text-muted-foreground border-border hover:border-border-bright hover:text-foreground'
      }`}
    >
      ALERTS
      {unread > 0 && (
        <span className="ml-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-accent-red text-white text-[11px] font-bold">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
