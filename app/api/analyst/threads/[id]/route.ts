import { prisma } from '@/lib/db'
import { apiRequireUser } from '@/lib/auth'
import { ok, fail } from '@/lib/api/response'

/** Full transcript for one thread, including the tool calls behind each answer. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const { id } = await params
  const thread = await prisma.analystThread.findFirst({
    where: { id, userId: guard.user.id },
    select: { id: true, title: true, entitySlug: true, createdAt: true },
  })
  if (!thread) return fail('Thread not found', 404)

  const messages = await prisma.analystMessage.findMany({
    where: { threadId: id },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })

  return ok({
    thread,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: safeParse(m.toolCalls),
      stopReason: m.stopReason,
      createdAt: m.createdAt,
    })),
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const { id } = await params
  // Scoped by userId so another user's thread id is a no-op, not a deletion.
  const deleted = await prisma.analystThread.deleteMany({
    where: { id, userId: guard.user.id },
  })
  if (deleted.count === 0) return fail('Thread not found', 404)

  return ok({ deleted: id })
}

function safeParse(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
