import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Check Your Email — Quaestron',
  robots: { index: false, follow: false },
}

export default function CheckEmailPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm border border-border bg-surface/60 backdrop-blur-sm rounded p-6">
        <div className="font-mono text-[10px] tracking-[0.3em] text-muted mb-1">
          LINK TRANSMITTED
        </div>
        <h1 className="font-mono text-lg tracking-wider text-foreground mb-4">
          <span className="text-accent-green">&#x2713;</span> CHECK YOUR EMAIL
        </h1>
        <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
          A single-use sign-in link is on its way. It expires in 24 hours and can
          only be opened once.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block px-3 py-2 font-mono text-xs tracking-[0.2em] text-muted-foreground border border-border hover:border-border-bright hover:text-foreground transition-colors"
        >
          RETURN TO MAP
        </Link>
      </div>
    </main>
  )
}
