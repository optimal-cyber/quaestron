import { prisma } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { ok } from '@/lib/api/response'

/**
 * Unread badge count for the nav. Polled by every page, so it stays a single
 * indexed COUNT and returns zero (not 401) when signed out — the nav shouldn't
 * have to special-case an error to render nothing.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return ok({ unreadCount: 0, authenticated: false })

  const unreadCount = await prisma.alertEvent.count({
    where: { userId: user.id, readAt: null },
  })

  return ok({ unreadCount, authenticated: true })
}
