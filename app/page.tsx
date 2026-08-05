'use client'

import { useEffect, useState, useRef, useCallback, type ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'

interface Stats {
  totalEntities: number
  totalConnections: number
  totalCountries: number
  typeCounts: { type: string; count: number }[]
}

interface GlobeMarker {
  lat: number
  lon: number
  name: string
  count: number
}

interface GlobeWrapperProps {
  connections?: unknown[]
  markers?: GlobeMarker[]
  onMarkerClick?: (marker: GlobeMarker) => void
  focusTarget?: { lat: number; lon: number }
}

// Typewriter effect hook
function useTypewriter(text: string, delay: number, speed = 40) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDisplayed('')
    setDone(false)
    const timer = setTimeout(() => {
      let i = 0
      const interval = setInterval(() => {
        setDisplayed(text.slice(0, i + 1))
        i++
        if (i >= text.length) {
          clearInterval(interval)
          setDone(true)
        }
      }, speed)
      return () => clearInterval(interval)
    }, delay)
    return () => clearTimeout(timer)
  }, [text, delay, speed])

  return { displayed, done }
}

// Scrolling data feed lines
const FEED_LINES = [
  'SCANNING DEFENSE CONTRACTORS...',
  'ENTITY: PALANTIR TECHNOLOGIES — TYPE: SURVEILLANCE',
  'CONNECTION: NSO GROUP → CIRCLES → GOVERNMENT',
  'FUNDING: BLACKROCK → ELBIT SYSTEMS — $2.1B',
  'CONTRACT: US DOD → ANDURIL — $967M',
  'ENTITY: CLEARVIEW AI — TYPE: FACIAL RECOGNITION',
  'SCANNING INVESTOR NETWORKS...',
  'CONNECTION: THOMA BRAVO → BARRACUDA NETWORKS',
  'ENTITY: BAE SYSTEMS — TYPE: DEFENSE PRIME',
  'CONTRACT: DHS → LEIDOS — $1.2B',
  'FUNDING: SEQUOIA → SHIELD AI — $165M',
  'ENTITY: CELLEBRITE — TYPE: DIGITAL FORENSICS',
  'SCANNING REGIONAL TARGETS...',
  'CONNECTION: BOEING → DARPA — PARTNERSHIP',
  'ENTITY: L3HARRIS — TYPE: DEFENSE / SIGINT',
  'FUNDING: ANDREESSEN HOROWITZ → ANDURIL — $450M',
]

export default function Home() {
  const router = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [globeMarkers, setGlobeMarkers] = useState<GlobeMarker[]>([])
  const [phase, setPhase] = useState<'boot' | 'reveal' | 'ready'>('boot')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [GlobeComponent, setGlobeComponent] = useState<ComponentType<any> | null>(null)
  const globeImported = useRef(false)

  // Load globe dynamically
  useEffect(() => {
    if (globeImported.current) return
    globeImported.current = true
    import('@/components/globe/GlobeWrapper').then((mod) => {
      setGlobeComponent(() => mod.default)
    })
  }, [])

  // Load data
  useEffect(() => {
    fetch('/api/stats').then((r) => r.json()).then(setStats).catch(console.error)
    fetch('/api/globe-markers').then((r) => r.json()).then((d) => setGlobeMarkers(d.markers || [])).catch(console.error)
  }, [])

  // Boot sequence
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('reveal'), 2200)
    const t2 = setTimeout(() => setPhase('ready'), 3200)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  const line1 = useTypewriter('THEY BUILD THE WEAPONS.', phase === 'reveal' || phase === 'ready' ? 0 : 99999, 35)
  const line2 = useTypewriter("IT'S TIME TO MAP", phase === 'reveal' || phase === 'ready' ? 900 : 99999, 30)
  const line3 = useTypewriter('THE ARSENAL.', phase === 'reveal' || phase === 'ready' ? 1600 : 99999, 35)

  return (
    <div className="h-screen w-screen bg-[#0B0F1A] overflow-hidden relative">
      {/* Globe background — fills entire viewport */}
      <div className="absolute inset-0 z-0">
        {GlobeComponent && (
          <GlobeComponent markers={globeMarkers} />
        )}
        {/* Gradient overlay — dark at top, transparent in middle, dark at bottom */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: `linear-gradient(
            to bottom,
            rgba(11,15,26,0.95) 0%,
            rgba(11,15,26,0.7) 25%,
            rgba(11,15,26,0.3) 50%,
            rgba(11,15,26,0.5) 70%,
            rgba(11,15,26,0.9) 100%
          )`,
        }} />
      </div>

      {/* Scan line animation */}
      <motion.div
        className="absolute left-0 right-0 h-px z-10 pointer-events-none"
        style={{ background: 'linear-gradient(to right, transparent, rgba(200,16,46,0.25), transparent)' }}
        animate={{ top: ['0%', '100%'] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />

      {/* Subtle grid overlay */}
      <div className="absolute inset-0 z-[1] opacity-[0.02] pointer-events-none" style={{
        backgroundImage: `linear-gradient(rgba(200,16,46,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(200,16,46,0.4) 1px, transparent 1px)`,
        backgroundSize: '50px 50px',
      }} />

      {/* Scrolling data feed — left side (hidden on mobile) */}
      <div className="hidden lg:block absolute left-4 top-20 bottom-20 w-72 z-[2] overflow-hidden pointer-events-none opacity-[0.12]">
        <motion.div
          animate={{ y: [0, -FEED_LINES.length * 28] }}
          transition={{ duration: FEED_LINES.length * 3, repeat: Infinity, ease: 'linear' }}
          className="font-mono text-[9px] tracking-wider text-accent-green/80"
        >
          {[...FEED_LINES, ...FEED_LINES].map((line, i) => (
            <div key={i} className="py-1 whitespace-nowrap">{line}</div>
          ))}
        </motion.div>
      </div>

      {/* Scrolling data feed — right side (hidden on mobile) */}
      <div className="hidden lg:block absolute right-4 top-20 bottom-20 w-72 z-[2] overflow-hidden pointer-events-none opacity-[0.12]">
        <motion.div
          animate={{ y: [-FEED_LINES.length * 28, 0] }}
          transition={{ duration: FEED_LINES.length * 3.5, repeat: Infinity, ease: 'linear' }}
          className="font-mono text-[9px] tracking-wider text-accent-blue/80 text-right"
        >
          {[...FEED_LINES, ...FEED_LINES].reverse().map((line, i) => (
            <div key={i} className="py-1 whitespace-nowrap">{line}</div>
          ))}
        </motion.div>
      </div>

      {/* Boot sequence overlay */}
      <AnimatePresence>
        {phase === 'boot' && (
          <motion.div
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 z-50 bg-[#0B0F1A] flex items-center justify-center"
          >
            <div className="text-center">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mb-6"
              >
                <div className="font-mono text-[10px] tracking-[0.5em] text-muted mb-4">INITIALIZING SECURE CONNECTION</div>
                <div className="flex items-center justify-center gap-3 mb-2">
                  <span className="text-accent-red text-xl">&lt;</span>
                  <span className="font-mono text-2xl tracking-[0.3em] text-foreground font-bold">IRON ECHELON</span>
                  <span className="text-accent-red text-xl">&gt;</span>
                </div>
                <div className="font-mono text-xs tracking-[0.2em] text-muted">DEFENSE TECH INTELLIGENCE</div>
              </motion.div>

              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '12rem' }}
                transition={{ duration: 1.8, ease: 'easeInOut' }}
                className="mx-auto"
              >
                <div className="h-0.5 bg-accent-red/60 rounded" />
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.0 }}
                className="mt-4 font-mono text-[9px] tracking-[0.3em] text-accent-green"
              >
                SYSTEMS ONLINE
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content — overlays globe */}
      <div className="relative z-10 h-full flex flex-col">
        {/* Nav */}
        <motion.nav
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: phase !== 'boot' ? 1 : 0, y: phase !== 'boot' ? 0 : -20 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="flex items-center justify-between px-4 md:px-8 py-4 md:py-5"
        >
          <div className="flex items-center gap-2">
            <span className="text-accent-red">&lt;</span>
            <span className="font-mono text-sm tracking-[0.2em] text-foreground font-bold">IRON ECHELON</span>
            <span className="text-accent-red">&gt;</span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            {[
              { label: 'MAP', href: '/map' },
              { label: 'NETWORK', href: '/network' },
              { label: 'FUNDERS', href: '/funders' },
              { label: 'CONTRACTS', href: '/contracts' },
              { label: 'INTEL', href: '/intel' },
              { label: 'ABOUT', href: '/about' },
            ].map((link) => (
              <button
                key={link.href}
                onClick={() => router.push(link.href)}
                className="font-mono text-[11px] tracking-[0.15em] text-muted hover:text-foreground transition-colors"
              >
                {link.label}
              </button>
            ))}
            <button
              onClick={() => router.push('/submit')}
              className="font-mono text-[11px] tracking-[0.15em] text-accent-red border border-accent-red/30 px-3 py-1 rounded hover:bg-accent-red/10 hover:border-accent-red/50 transition-colors"
            >
              SUBMIT
            </button>
            <a
              href="https://www.ironechelon.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] tracking-[0.15em] text-accent-gold border border-accent-gold/30 px-3 py-1 rounded hover:bg-accent-gold/10 hover:border-accent-gold/50 transition-colors"
            >
              NEWSLETTER
            </a>
          </div>
          {/* Mobile: just show key actions */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={() => router.push('/map')}
              className="font-mono text-[10px] tracking-[0.15em] text-muted hover:text-foreground transition-colors"
            >
              ENTER
            </button>
            <button
              onClick={() => router.push('/submit')}
              className="font-mono text-[10px] tracking-[0.1em] text-accent-red border border-accent-red/30 px-2 py-0.5 rounded"
            >
              SUBMIT
            </button>
          </div>
        </motion.nav>

        {/* Hero text over globe */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 md:px-8">
          <div className="text-center max-w-3xl">
            {/* Line 1 — typewriter */}
            <div className="font-mono text-sm md:text-lg lg:text-xl tracking-[0.2em] md:tracking-[0.3em] text-slate-300 mb-4 md:mb-6 font-medium min-h-[1.5rem] md:min-h-[2rem]">
              {line1.displayed}
              {!line1.done && <span className="animate-pulse text-accent-red">|</span>}
            </div>

            {/* Line 2 */}
            <h1 className="font-mono text-2xl sm:text-4xl md:text-6xl tracking-[0.08em] text-white font-bold leading-tight mb-2 md:mb-3 min-h-[2.5rem] md:min-h-[4rem]">
              {line2.displayed}
              {!line2.done && line1.done && <span className="animate-pulse text-accent-red">|</span>}
            </h1>

            {/* Line 3 — red accent */}
            <h1 className="font-mono text-2xl sm:text-4xl md:text-6xl tracking-[0.08em] font-bold leading-tight mb-8 md:mb-12 min-h-[2.5rem] md:min-h-[4rem]">
              <span className="text-accent-red">{line3.displayed}</span>
              {!line3.done && line2.done && <span className="animate-pulse text-white">|</span>}
            </h1>

            {/* Subtitle — fades in after typing done */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: line3.done ? 1 : 0, y: line3.done ? 0 : 10 }}
              transition={{ duration: 0.8 }}
              className="text-slate-400 text-sm md:text-base max-w-xl mx-auto leading-relaxed mb-8 md:mb-14 px-2"
            >
              Quaestron is an interactive intelligence platform mapping the defense technology,
              cybersecurity, AI, and surveillance ecosystem — companies, investors, contracts,
              and the connections between them.
            </motion.p>
          </div>

          {/* CTA Cards */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: line3.done ? 1 : 0, y: line3.done ? 0 : 30 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 max-w-3xl w-full"
          >
            <button
              onClick={() => router.push('/map')}
              className="group bg-black/40 backdrop-blur-sm border border-white/10 hover:border-accent-green/50 rounded-lg px-5 py-4 text-left transition-all hover:bg-black/60"
            >
              <div className="font-mono text-[10px] tracking-[0.2em] text-accent-green mb-2 flex items-center justify-between">
                EXPLORE ENTITIES
                <svg className="w-3.5 h-3.5 text-muted group-hover:text-accent-green transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>
              <div className="text-xs text-slate-400">
                Browse {stats?.totalEntities || '1,600+'} surveillance & defense tech companies on the globe.
              </div>
            </button>
            <button
              onClick={() => router.push('/network')}
              className="group bg-black/40 backdrop-blur-sm border border-white/10 hover:border-accent-gold/50 rounded-lg px-5 py-4 text-left transition-all hover:bg-black/60"
            >
              <div className="font-mono text-[10px] tracking-[0.2em] text-accent-gold mb-2 flex items-center justify-between">
                MAP THE NETWORK
                <svg className="w-3.5 h-3.5 text-muted group-hover:text-accent-gold transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>
              <div className="text-xs text-slate-400">
                Visualize supply chains and funding flows in interactive Sankey diagrams.
              </div>
            </button>
            <button
              onClick={() => router.push('/funders')}
              className="group bg-black/40 backdrop-blur-sm border border-white/10 hover:border-accent-blue/50 rounded-lg px-5 py-4 text-left transition-all hover:bg-black/60"
            >
              <div className="font-mono text-[10px] tracking-[0.2em] text-accent-blue mb-2 flex items-center justify-between">
                FOLLOW THE MONEY
                <svg className="w-3.5 h-3.5 text-muted group-hover:text-accent-blue transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>
              <div className="text-xs text-slate-400">
                Track who funds surveillance tech — from BlackRock to state-backed VC funds.
              </div>
            </button>
          </motion.div>

          {/* Stats bar */}
          {stats && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: line3.done ? 1 : 0 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="flex flex-wrap items-center justify-center gap-4 md:gap-8 mt-6 md:mt-10 font-mono text-[9px] md:text-[10px] tracking-[0.2em] text-muted"
            >
              <span><span className="text-accent-red font-bold">{stats.totalEntities}</span> ENTITIES</span>
              <span className="text-white/10">|</span>
              <span><span className="text-accent-blue font-bold">{stats.totalConnections}</span> CONNECTIONS</span>
              <span className="text-white/10">|</span>
              <span><span className="text-accent-green font-bold">{stats.totalCountries}</span> COUNTRIES</span>
              <span className="text-white/10">|</span>
              <span><span className="text-accent-gold font-bold">{stats.typeCounts.length}</span> CATEGORIES</span>
            </motion.div>
          )}
        </div>

        {/* Bottom bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === 'ready' ? 1 : 0 }}
          transition={{ delay: 0.5 }}
          className="px-8 py-4 flex items-center justify-between border-t border-white/5"
        >
          <div className="font-mono text-[9px] tracking-[0.2em] text-muted flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
            SYSTEMS ACTIVE
          </div>
          <div className="font-mono text-[9px] tracking-[0.2em] text-muted">
            IRON ECHELON v1.0 — DATA SYNCED DAILY
          </div>
        </motion.div>
      </div>
    </div>
  )
}
