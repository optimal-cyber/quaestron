'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import AuthMenu from './AuthMenu'
import AlertsBadge from './AlertsBadge'

const navItems = [
  { href: '/map', label: 'MAP' },
  { href: '/network', label: 'NETWORK' },
  { href: '/funders', label: 'FUNDERS' },
  { href: '/contracts', label: 'CONTRACTS' },
  { href: '/vendors', label: 'VENDORS' },
  { href: '/ato', label: 'ATO' },
  { href: '/intel', label: 'INTEL' },
  { href: '/about', label: 'ABOUT' },
]

export default function TopNav({ onSearchOpen }: { onSearchOpen?: () => void }) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 h-12 bg-surface/90 backdrop-blur-md border-b border-border flex items-center px-3 md:px-4 gap-2 md:gap-6">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-accent-red font-mono font-bold text-xs md:text-sm tracking-[0.2em]">
            &#x276E; IRON ECHELON
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1 ml-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 text-xs font-mono tracking-wider transition-colors rounded ${
                  isActive
                    ? 'text-accent-red bg-accent-red/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={onSearchOpen}
            className="flex items-center gap-2 px-2 md:px-3 py-1.5 text-xs font-mono text-muted rounded border border-border hover:border-border-bright hover:text-muted-foreground transition-colors"
          >
            <span>SEARCH</span>
            <kbd className="hidden md:inline text-[10px] bg-background px-1 py-0.5 rounded">⌘K</kbd>
          </button>
          <Link
            href="/submit"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono tracking-wider text-accent-red rounded border border-accent-red/30 hover:bg-accent-red/10 hover:border-accent-red/50 transition-colors"
          >
            SUBMIT
          </Link>
          <a
            href="https://www.ironechelon.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono tracking-wider text-accent-gold rounded border border-accent-gold/30 hover:bg-accent-gold/10 hover:border-accent-gold/50 transition-colors"
          >
            NEWSLETTER
          </a>

          <div className="hidden sm:block">
            <AlertsBadge />
          </div>
          <AuthMenu />

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden flex flex-col gap-1 p-2"
            aria-label="Toggle menu"
          >
            <span className={`w-4 h-0.5 bg-foreground transition-transform ${menuOpen ? 'rotate-45 translate-y-1.5' : ''}`} />
            <span className={`w-4 h-0.5 bg-foreground transition-opacity ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`w-4 h-0.5 bg-foreground transition-transform ${menuOpen ? '-rotate-45 -translate-y-1.5' : ''}`} />
          </button>
        </div>
      </nav>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 pt-12 bg-surface/95 backdrop-blur-md md:hidden">
          <div className="flex flex-col p-4 gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`px-4 py-3 text-sm font-mono tracking-wider transition-colors rounded ${
                    isActive
                      ? 'text-accent-red bg-accent-red/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
            <div className="border-t border-border my-2" />
            <AlertsBadge mobile />
            <Link
              href="/watchlists"
              onClick={() => setMenuOpen(false)}
              className="px-4 py-3 text-sm font-mono tracking-wider text-muted-foreground hover:bg-surface-hover hover:text-foreground rounded transition-colors"
            >
              WATCHLISTS
            </Link>
            <Link
              href="/submit"
              onClick={() => setMenuOpen(false)}
              className="px-4 py-3 text-sm font-mono tracking-wider text-accent-red hover:bg-accent-red/10 rounded transition-colors"
            >
              SUBMIT INTEL
            </Link>
            <a
              href="https://www.ironechelon.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-3 text-sm font-mono tracking-wider text-accent-gold hover:bg-accent-gold/10 rounded transition-colors"
            >
              NEWSLETTER
            </a>
            <Link
              href="/signin"
              onClick={() => setMenuOpen(false)}
              className="px-4 py-3 text-sm font-mono tracking-wider text-muted-foreground hover:bg-surface-hover hover:text-foreground rounded transition-colors"
            >
              ACCOUNT
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
