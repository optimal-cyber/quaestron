import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiRequireUser } from '@/lib/auth'
import { ok, fail, parseBody, parseQuery } from '@/lib/api/response'
import { TARGET_TYPES } from '@/lib/alerts/types'
import {
  assertCanAddItem,
  getOrCreateDefaultWatchlist,
  targetKeyFor,
} from '@/lib/alerts/watchlists'

/**
 * One-click WATCH toggle used by vendor and entity pages.
 *
 * Wraps the explicit watchlist API so the button doesn't have to make the user
 * pick a list first: it targets their oldest watchlist, creating a "Default"
 * one on first use.
 */

const watchSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().trim().min(1).max(120).nullish(),
  targetValue: z.string().trim().min(1).max(200).nullish(),
  label: z.string().trim().min(1).max(200).nullish(),
  /** Add to a specific list instead of the default. */
  watchlistId: z.string().trim().min(1).max(120).nullish(),
})

const statusSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().trim().optional(),
  targetValue: z.string().trim().optional(),
})

/** Is this target on any of the user's lists? Drives the button's state. */
export async function GET(request: Request) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const parsed = parseQuery(statusSchema, new URL(request.url))
  if (!parsed.ok) return parsed.response

  const targetKey = targetKeyFor(parsed.value)
  if (!targetKey) return fail('targetId or targetValue is required', 400)

  const item = await prisma.watchlistItem.findFirst({
    where: {
      targetType: parsed.value.targetType,
      targetKey,
      watchlist: { userId: guard.user.id },
    },
    select: { id: true, watchlistId: true, watchlist: { select: { name: true } } },
  })

  return ok({
    watching: Boolean(item),
    itemId: item?.id ?? null,
    watchlistId: item?.watchlistId ?? null,
    watchlistName: item?.watchlist.name ?? null,
  })
}

export async function POST(request: Request) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const parsed = await parseBody(watchSchema, request)
  if (!parsed.ok) return parsed.response
  const { targetType, targetId, targetValue, label, watchlistId } = parsed.value

  const targetKey = targetKeyFor({ targetType, targetId, targetValue })
  if (!targetKey) return fail('targetId or targetValue is required', 400)

  if (targetType === 'ENTITY') {
    const entity = await prisma.entity.findUnique({ where: { id: targetId! } })
    if (!entity) return fail('Entity not found', 404)
  }

  let listId = watchlistId ?? null
  if (listId) {
    const owned = await prisma.watchlist.findFirst({
      where: { id: listId, userId: guard.user.id },
    })
    if (!owned) return fail('Watchlist not found', 404)
  } else {
    listId = (await getOrCreateDefaultWatchlist(guard.user)).id
  }

  const existing = await prisma.watchlistItem.findUnique({
    where: { watchlistId_targetType_targetKey: { watchlistId: listId, targetType, targetKey } },
  })
  if (existing) return ok({ watching: true, itemId: existing.id, watchlistId: listId })

  const limitError = await assertCanAddItem(guard.user, listId)
  if (limitError) return fail(limitError.message, 403, { code: limitError.code })

  const item = await prisma.watchlistItem.create({
    data: {
      watchlistId: listId,
      targetType,
      targetId: targetId ?? null,
      targetValue: targetValue ?? null,
      targetKey,
      label: label ?? null,
    },
  })

  return ok({ watching: true, itemId: item.id, watchlistId: listId }, { status: 201 })
}

/** Unwatch — removes the target from every list the user owns. */
export async function DELETE(request: Request) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const parsed = parseQuery(statusSchema, new URL(request.url))
  if (!parsed.ok) return parsed.response

  const targetKey = targetKeyFor(parsed.value)
  if (!targetKey) return fail('targetId or targetValue is required', 400)

  const deleted = await prisma.watchlistItem.deleteMany({
    where: {
      targetType: parsed.value.targetType,
      targetKey,
      watchlist: { userId: guard.user.id },
    },
  })

  return ok({ watching: false, removed: deleted.count })
}
