import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { enabledProviders, getSessionUser } from '@/lib/auth'
import SignInForm from './SignInForm'

export const metadata: Metadata = {
  title: 'Sign In — Quaestron',
  robots: { index: false, follow: false },
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}) {
  const { callbackUrl, error } = await searchParams

  const user = await getSessionUser()
  if (user) redirect(safeCallback(callbackUrl))

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-16">
      <SignInForm
        callbackUrl={safeCallback(callbackUrl)}
        error={error}
        providers={enabledProviders}
      />
    </main>
  )
}

/** Only allow same-origin relative paths — blocks open-redirect via ?callbackUrl. */
function safeCallback(url: string | undefined): string {
  if (!url) return '/'
  if (!url.startsWith('/') || url.startsWith('//')) return '/'
  return url
}
