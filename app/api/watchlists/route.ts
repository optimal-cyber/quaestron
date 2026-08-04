import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiRequireUser } from '@/lib/auth'
import { ok, fail, parseBody } from '@/lib/api/response'
import { assertCanCreateWatchlist, serializeLimits } from '@/lib/alerts/watchlists'

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

/** All of the signed-in user's watchlists, with items and attached rule count. */
export async function GET() {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const watchlists = await prisma.watchlist.findMany({
    where: { userId: guard.user.id },
    orderBy: { createdAt: 'asc' },
    include: {
      items: { orderBy: { createdAt: 'desc' } },
      _count: { select: { rules: true } },
    },
  })

  return ok({
    watchlists: watchlists.map((w) => ({
      id: w.id,
      name: w.name,
      createdAt: w.createdAt,
      ruleCount: w._count.rules,
      items: w.items.map((i) => ({
        id: i.id,
        targetType: i.targetType,
        targetId: i.targetId,
        targetValue: i.targetValue,
        targetKey: i.targetKey,
        label: i.label,
        createdAt: i.createdAt,
      })),
    })),
    limits: serializeLimits(guard.user.tier),
    tier: guard.user.tier,
  })
}

export async function POST(request: Request) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const parsed = await parseBody(createSchema, request)
  if (!parsed.ok) return parsed.response

  const limitError = await assertCanCreateWatchlist(guard.user)
  if (limitError) return fail(limitError.message, 403, { code: limitError.code })

  const watchlist = await prisma.watchlist.create({
    data: { userId: guard.user.id, name: parsed.value.name },
  })

  return ok({ watchlist }, { status: 201 })
}
