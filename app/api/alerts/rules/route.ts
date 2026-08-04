import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiRequireUser } from '@/lib/auth'
import { ok, fail, parseBody } from '@/lib/api/response'
import {
  CHANNELS,
  FREQUENCIES,
  limitsFor,
  RULE_TARGETS,
  RULE_TYPES,
  ruleParamsSchema,
} from '@/lib/alerts/types'
import { ownedWatchlist, serializeLimits } from '@/lib/alerts/watchlists'

const createSchema = z.object({
  ruleType: z.enum(RULE_TYPES),
  watchlistId: z.string().trim().min(1).max(120),
  channel: z.enum(CHANNELS).default('EMAIL'),
  frequency: z.enum(FREQUENCIES).default('WEEKLY'),
  params: ruleParamsSchema.default({}),
})

export async function GET() {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const rules = await prisma.alertRule.findMany({
    where: { userId: guard.user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      watchlist: { select: { id: true, name: true, _count: { select: { items: true } } } },
      _count: { select: { events: true } },
    },
  })

  return ok({
    rules: rules.map((r) => ({
      id: r.id,
      ruleType: r.ruleType,
      channel: r.channel,
      frequency: r.frequency,
      active: r.active,
      params: r.params,
      lastRunAt: r.lastRunAt,
      createdAt: r.createdAt,
      eventCount: r._count.events,
      watchlist: r.watchlist
        ? { id: r.watchlist.id, name: r.watchlist.name, itemCount: r.watchlist._count.items }
        : null,
    })),
    limits: serializeLimits(guard.user.tier),
    ruleTargets: RULE_TARGETS,
  })
}

export async function POST(request: Request) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response

  const parsed = await parseBody(createSchema, request)
  if (!parsed.ok) return parsed.response
  const { ruleType, watchlistId, channel, frequency, params } = parsed.value

  const watchlist = await ownedWatchlist(guard.user.id, watchlistId)
  if (!watchlist) return fail('Watchlist not found', 404)

  const limits = limitsFor(guard.user.tier)
  if (!limits.frequencies.includes(frequency)) {
    return fail(
      `${frequency} alerts are not available on the ${guard.user.tier} tier (allowed: ${limits.frequencies.join(', ')}).`,
      403,
      { code: 'FREQUENCY_LIMIT', allowed: limits.frequencies }
    )
  }

  const existing = await prisma.alertRule.findFirst({
    where: { userId: guard.user.id, watchlistId, ruleType },
  })
  if (existing) {
    return fail('A rule of this type already exists for that watchlist', 409, {
      code: 'DUPLICATE_RULE',
      ruleId: existing.id,
    })
  }

  const rule = await prisma.alertRule.create({
    data: {
      userId: guard.user.id,
      watchlistId,
      ruleType,
      channel,
      frequency,
      params: JSON.stringify(params),
    },
  })

  return ok({ rule }, { status: 201 })
}
