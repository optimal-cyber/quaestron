import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiRequireUser } from '@/lib/auth'
import { ok, parseBody } from '@/lib/api/response'
import { serializeLimits } from '@/lib/alerts/watchlists'

const patchSchema = z.object({
  alertEmailOptIn: z.boolean().optional(),
  name: z.string().trim().min(1).max(120).nullish(),
})

export async function GET() {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  return ok({
    user: {
      id: guard.user.id,
      email: guard.user.email,
      name: guard.user.name,
      tier: guard.user.tier,
      role: guard.user.role,
      alertEmailOptIn: guard.user.alertEmailOptIn,
    },
    limits: serializeLimits(guard.user.tier),
  })
}

export async function PATCH(request: Request) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const parsed = await parseBody(patchSchema, request)
  if (!parsed.ok) return parsed.response

  const user = await prisma.user.update({
    where: { id: guard.user.id },
    data: {
      ...(parsed.value.alertEmailOptIn !== undefined
        ? { alertEmailOptIn: parsed.value.alertEmailOptIn }
        : {}),
      ...(parsed.value.name !== undefined ? { name: parsed.value.name } : {}),
    },
    select: { id: true, email: true, name: true, tier: true, alertEmailOptIn: true },
  })

  return ok({ user })
}
