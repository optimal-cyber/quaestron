import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiRequireUser } from '@/lib/auth'
import { ok, fail, parseBody } from '@/lib/api/response'
import { CHANNELS, FREQUENCIES, limitsFor, ruleParamsSchema } from '@/lib/alerts/types'

const patchSchema = z
  .object({
    channel: z.enum(CHANNELS).optional(),
    frequency: z.enum(FREQUENCIES).optional(),
    active: z.boolean().optional(),
    params: ruleParamsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const { id } = await params
  const existing = await prisma.alertRule.findFirst({
    where: { id, userId: guard.user.id },
  })
  if (!existing) return fail('Alert rule not found', 404)

  const parsed = await parseBody(patchSchema, request)
  if (!parsed.ok) return parsed.response
  const update = parsed.value

  if (update.frequency) {
    const limits = limitsFor(guard.user.tier)
    if (!limits.frequencies.includes(update.frequency)) {
      return fail(
        `${update.frequency} alerts are not available on the ${guard.user.tier} tier (allowed: ${limits.frequencies.join(', ')}).`,
        403,
        { code: 'FREQUENCY_LIMIT', allowed: limits.frequencies }
      )
    }
  }

  const rule = await prisma.alertRule.update({
    where: { id },
    data: {
      ...(update.channel ? { channel: update.channel } : {}),
      ...(update.frequency ? { frequency: update.frequency } : {}),
      ...(update.active !== undefined ? { active: update.active } : {}),
      ...(update.params ? { params: JSON.stringify(update.params) } : {}),
    },
  })

  return ok({ rule })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const { id } = await params
  // deleteMany scoped by userId so another user's rule id can't be deleted.
  const deleted = await prisma.alertRule.deleteMany({
    where: { id, userId: guard.user.id },
  })
  if (deleted.count === 0) return fail('Alert rule not found', 404)

  return ok({ deleted: id })
}
