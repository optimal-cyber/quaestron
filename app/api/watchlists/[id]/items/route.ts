import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiRequireUser } from '@/lib/auth'
import { ok, fail, parseBody } from '@/lib/api/response'
import { TARGET_TYPES } from '@/lib/alerts/types'
import { assertCanAddItem, ownedWatchlist, targetKeyFor } from '@/lib/alerts/watchlists'

const addSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().trim().min(1).max(120).nullish(),
  targetValue: z.string().trim().min(1).max(200).nullish(),
  label: z.string().trim().min(1).max(200).nullish(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const { id } = await params
  const watchlist = await ownedWatchlist(guard.user.id, id)
  if (!watchlist) return fail('Watchlist not found', 404)

  const parsed = await parseBody(addSchema, request)
  if (!parsed.ok) return parsed.response
  const { targetType, targetId, targetValue, label } = parsed.value

  const targetKey = targetKeyFor({ targetType, targetId, targetValue })
  if (!targetKey) {
    return fail(
      targetType === 'ENTITY'
        ? 'targetId is required for ENTITY targets'
        : 'targetValue is required for this target type',
      400
    )
  }

  if (targetType === 'ENTITY') {
    const entity = await prisma.entity.findUnique({ where: { id: targetId! } })
    if (!entity) return fail('Entity not found', 404)
  }

  const limitError = await assertCanAddItem(guard.user, id)
  if (limitError) {
    // An item already on the list isn't a new item, so re-adding shouldn't be
    // blocked by the cap — check for that before refusing.
    const duplicate = await prisma.watchlistItem.findUnique({
      where: { watchlistId_targetType_targetKey: { watchlistId: id, targetType, targetKey } },
    })
    if (!duplicate) return fail(limitError.message, 403, { code: limitError.code })
    return ok({ item: duplicate, alreadyPresent: true })
  }

  const item = await prisma.watchlistItem.upsert({
    where: { watchlistId_targetType_targetKey: { watchlistId: id, targetType, targetKey } },
    create: {
      watchlistId: id,
      targetType,
      targetId: targetId ?? null,
      targetValue: targetValue ?? null,
      targetKey,
      label: label ?? null,
    },
    update: { label: label ?? undefined },
  })

  return ok({ item }, { status: 201 })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const { id } = await params
  const watchlist = await ownedWatchlist(guard.user.id, id)
  if (!watchlist) return fail('Watchlist not found', 404)

  const itemId = new URL(request.url).searchParams.get('itemId')
  if (!itemId) return fail('itemId query parameter is required', 400)

  // Scoped to this watchlist so an id from someone else's list can't be deleted.
  const deleted = await prisma.watchlistItem.deleteMany({
    where: { id: itemId, watchlistId: id },
  })
  if (deleted.count === 0) return fail('Item not found', 404)

  return ok({ deleted: itemId })
}
