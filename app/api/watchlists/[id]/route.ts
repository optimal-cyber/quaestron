import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiRequireUser } from '@/lib/auth'
import { ok, fail, parseBody } from '@/lib/api/response'
import { ownedWatchlist } from '@/lib/alerts/watchlists'

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const { id } = await params
  const existing = await ownedWatchlist(guard.user.id, id)
  if (!existing) return fail('Watchlist not found', 404)

  const parsed = await parseBody(patchSchema, request)
  if (!parsed.ok) return parsed.response

  const watchlist = await prisma.watchlist.update({
    where: { id },
    data: { name: parsed.value.name },
  })

  return ok({ watchlist })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const { id } = await params
  const existing = await ownedWatchlist(guard.user.id, id)
  if (!existing) return fail('Watchlist not found', 404)

  // Items and attached rules cascade via the schema's onDelete.
  await prisma.watchlist.delete({ where: { id } })

  return ok({ deleted: id })
}
