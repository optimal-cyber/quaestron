import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiRequireUser } from '@/lib/auth'
import { ok, fail, parseBody, parseQuery } from '@/lib/api/response'

const querySchema = z.object({
  unread: z.enum(['0', '1']).optional(),
  ruleType: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().max(120).optional(),
})

const patchSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(200).optional(),
    /** Mark the user's entire inbox read. */
    all: z.boolean().optional(),
    read: z.boolean().default(true),
  })
  .refine((v) => v.all || (v.ids && v.ids.length > 0), {
    message: 'Provide ids or all=true',
  })

/** Alert inbox, newest first, cursor-paginated. */
export async function GET(request: Request) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const parsed = parseQuery(querySchema, new URL(request.url))
  if (!parsed.ok) return parsed.response
  const { unread, ruleType, limit, cursor } = parsed.value

  const where = {
    userId: guard.user.id,
    ...(unread === '1' ? { readAt: null } : {}),
    ...(ruleType ? { ruleType } : {}),
  }

  const events = await prisma.alertEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      ruleType: true,
      title: true,
      body: true,
      url: true,
      entityId: true,
      readAt: true,
      createdAt: true,
    },
  })

  const hasMore = events.length > limit
  const page = hasMore ? events.slice(0, limit) : events

  const unreadCount = await prisma.alertEvent.count({
    where: { userId: guard.user.id, readAt: null },
  })

  return ok({
    events: page,
    unreadCount,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  })
}

/** Mark events read or unread. */
export async function PATCH(request: Request) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const parsed = await parseBody(patchSchema, request)
  if (!parsed.ok) return parsed.response
  const { ids, all, read } = parsed.value

  const readAt = read ? new Date() : null

  // Always scoped by userId, so an id belonging to another user is a no-op
  // rather than a cross-tenant write.
  const updated = await prisma.alertEvent.updateMany({
    where: {
      userId: guard.user.id,
      ...(all ? {} : { id: { in: ids! } }),
      ...(read ? { readAt: null } : {}),
    },
    data: { readAt },
  })

  if (updated.count === 0 && !all && ids && ids.length > 0) {
    // Either already in the requested state or not theirs — not an error.
    return ok({ updated: 0 })
  }

  return ok({ updated: updated.count })
}

export async function DELETE(request: Request) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return fail('id query parameter is required', 400)

  const deleted = await prisma.alertEvent.deleteMany({
    where: { id, userId: guard.user.id },
  })
  if (deleted.count === 0) return fail('Alert not found', 404)

  return ok({ deleted: id })
}
