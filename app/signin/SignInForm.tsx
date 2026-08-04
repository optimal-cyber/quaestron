'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'

const AUTH_ERRORS: Record<string, string> = {
  OAuthAccountNotLinked: 'That email is already registered with a different sign-in method.',
  AccessDenied: 'Access denied.',
  Verification: 'That sign-in link has expired or was already used.',
  Configuration: 'Sign-in is not configured on this deployment.',
}

export default function SignInForm({
  callbackUrl,
  error,
  providers,
}: {
  callbackUrl: string
  error?: string
  providers: { email: boolean; google: boolean }
}) {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState<null | 'email' | 'google'>(null)

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setPending('email')
    await signIn('resend', { email: email.trim(), callbackUrl })
    setPending(null)
  }

  const noProviders = !providers.email && !providers.google

  return (
    <div className="w-full max-w-sm">
      <div className="border border-border bg-surface/60 backdrop-blur-sm rounded p-6">
        <div className="font-mono text-[10px] tracking-[0.3em] text-muted mb-1">
          RESTRICTED ACCESS
        </div>
        <h1 className="font-mono text-lg tracking-wider text-foreground mb-6">
          <span className="text-accent-red">&#x276E;</span> SIGN IN
        </h1>

        {error && (
          <div className="mb-5 border border-accent-red/40 bg-accent-red/10 px-3 py-2 font-mono text-[11px] text-accent-red">
            {AUTH_ERRORS[error] || 'Sign-in failed. Try again.'}
          </div>
        )}

        {noProviders && (
          <div className="mb-5 border border-accent-gold/40 bg-accent-gold/10 px-3 py-2 font-mono text-[11px] text-accent-gold">
            No sign-in providers configured. Set RESEND_API_KEY or
            GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
          </div>
        )}

        {providers.email && (
          <form onSubmit={submitEmail} className="space-y-3">
            <label
              htmlFor="email"
              className="block font-mono text-[10px] tracking-[0.2em] text-muted"
            >
              EMAIL
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="analyst@agency.gov"
              className="w-full bg-background border border-border focus:border-accent-blue px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={pending !== null}
              className="w-full px-3 py-2 font-mono text-xs tracking-[0.2em] text-accent-red border border-accent-red/40 hover:bg-accent-red/10 hover:border-accent-red/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pending === 'email' ? 'TRANSMITTING…' : 'SEND SIGN-IN LINK'}
            </button>
          </form>
        )}

        {providers.email && providers.google && (
          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted">OR</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        )}

        {providers.google && (
          <button
            onClick={() => {
              setPending('google')
              void signIn('google', { callbackUrl })
            }}
            disabled={pending !== null}
            className="w-full px-3 py-2 font-mono text-xs tracking-[0.2em] text-muted-foreground border border-border hover:border-border-bright hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {pending === 'google' ? 'REDIRECTING…' : 'CONTINUE WITH GOOGLE'}
          </button>
        )}
      </div>

      <p className="mt-4 font-mono text-[10px] leading-relaxed text-muted">
        Sign-in is required for watchlists, alerts, and exports. Browsing the map,
        network, and vendor pages stays open.
      </p>
    </div>
  )
}
