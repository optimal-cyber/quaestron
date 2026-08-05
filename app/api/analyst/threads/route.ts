import { prisma } from '@/lib/db'
import { apiRequireUser } from '@/lib/auth'
import { ok } from '@/lib/api/response'
import { analystConfigured, analystModel } from '@/lib/ai/analyst'
import { checkAnalystQuota } from '@/lib/ai/quota'

/** The user's analyst threads, plus their current quota standing. */
export async function GET() {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const [threads, quota] = await Promise.all([
    prisma.analystThread.findMany({
      where: { userId: guard.user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        entitySlug: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    }),
    // Peek, not consume — rendering the counter must not spend an allowance.
    checkAnalystQuota(guard.user, { consume: false }),
  ])

  return ok({
    threads: threads.map((t) => ({
      id: t.id,
      title: t.title,
      entitySlug: t.entitySlug,
      updatedAt: t.updatedAt,
      messageCount: t._count.messages,
    })),
    quota: {
      remaining: quota.remaining,
      limit: quota.limit,
      resetAt: quota.resetAt,
      unlimited: quota.limit === null,
    },
    tier: guard.user.tier,
    configured: analystConfigured(),
    model: analystConfigured() ? analystModel() : null,
  })
}
