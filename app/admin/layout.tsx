import { requireAdminUser } from '@/lib/auth'

/**
 * Admin is gated on `User.role === 'ADMIN'` — non-admins are redirected home
 * rather than shown a 403, so the panel's existence isn't advertised.
 *
 * Bootstrap: `npm run admin:promote -- you@example.com` creates or promotes the
 * user, so the first admin can be established before anyone has signed in.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminUser('/admin')
  return <>{children}</>
}
