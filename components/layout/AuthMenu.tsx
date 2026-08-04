'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'

const TIER_COLOR: Record<string, string> = {
  FREE: 'text-muted',
  PRO: 'text-accent-gold',
  TEAM: 'text-accent-green',
}

export default function AuthMenu() {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Reserve the slot while the session resolves so the nav doesn't jump.
  if (status === 'loading') {
    return <div className="hidden sm:block w-[72px] h-[30px]" aria-hidden />
  }

  if (!session?.user) {
    return (
      <Link
        href={`/signin?callbackUrl=${encodeURIComponent(pathname || '/')}`}
        className="hidden sm:flex items-center px-3 py-1.5 text-xs font-mono tracking-wider text-muted-foreground rounded border border-border hover:border-border-bright hover:text-foreground transition-colors"
      >
        SIGN IN
      </Link>
    )
  }

  const { email, tier, role } = session.user
  const label = email?.split('@')[0]?.slice(0, 12) || 'ACCOUNT'

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-wider text-muted-foreground rounded border border-border hover:border-border-bright hover:text-foreground transition-colors"
      >
        <span className="uppercase">{label}</span>
        <span className={TIER_COLOR[tier] || 'text-muted'}>{tier}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 border border-border bg-surface rounded shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <div className="font-mono text-[10px] text-muted truncate">{email}</div>
            <div className="font-mono text-[10px] mt-0.5">
              <span className="text-muted">TIER </span>
              <span className={TIER_COLOR[tier] || 'text-muted'}>{tier}</span>
              {role === 'ADMIN' && <span className="text-accent-red ml-2">ADMIN</span>}
            </div>
          </div>
          {role === 'ADMIN' && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 font-mono text-[11px] tracking-wider text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              ADMIN PANEL
            </Link>
          )}
          <button
            onClick={() => void signOut({ callbackUrl: '/' })}
            className="w-full text-left px-3 py-2 font-mono text-[11px] tracking-wider text-accent-red hover:bg-accent-red/10 transition-colors"
          >
            SIGN OUT
          </button>
        </div>
      )}
    </div>
  )
}
