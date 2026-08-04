import { z } from 'zod'
import { prisma } from '@/lib/db'
import { ok, fail, parseBody, parseQuery } from '@/lib/api/response'
import { requireAdminRequest } from '@/lib/admin-auth'
import { normalizeVendorName, slugify } from '@/lib/match/vendor-name'

/**
 * Review queue for ATO-feed vendor names the matcher wouldn't auto-link.
 *
 * Resolving a name links every row from that source carrying it, so one
 * decision clears all of a CSP's offerings at once.
 */

const listSchema = z.object({
  status: z.enum(['PENDING', 'RESOLVED', 'IGNORED']).default('PENDING'),
  sourceType: z.enum(['FEDRAMP', 'DOD_PA', 'EMASS']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

const resolveSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['LINK', 'IGNORE', 'REOPEN', 'CREATE_ENTITY']),
  /** Required for LINK. */
  entityId: z.string().min(1).optional(),
  /** Optional override of the auto-derived name for CREATE_ENTITY. */
  entityName: z.string().trim().min(1).max(160).optional(),
  entityType: z.string().trim().min(1).max(40).optional(),
})

export async function GET(request: Request) {
  const admin = await requireAdminRequest(request)
  if (!admin.ok) return admin.response

  const parsed = parseQuery(listSchema, new URL(request.url))
  if (!parsed.ok) return parsed.response
  const { status, sourceType, limit } = parsed.value

  const items = await prisma.atoMatchReview.findMany({
    where: { status, ...(sourceType ? { sourceType } : {}) },
    orderBy: [{ recordCount: 'desc' }, { lastSeenAt: 'desc' }],
    take: limit,
  })

  const counts = await prisma.atoMatchReview.groupBy({
    by: ['status'],
    _count: { _all: true },
  })

  return ok({
    items: items.map((i) => ({
      id: i.id,
      sourceType: i.sourceType,
      sourceName: i.sourceName,
      normalizedName: i.normalizedName,
      recordCount: i.recordCount,
      status: i.status,
      resolvedEntityId: i.resolvedEntityId,
      suggestions: safeSuggestions(i.suggestions),
      lastSeenAt: i.lastSeenAt,
    })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  })
}

export async function POST(request: Request) {
  const admin = await requireAdminRequest(request)
  if (!admin.ok) return admin.response

  const parsed = await parseBody(resolveSchema, request)
  if (!parsed.ok) return parsed.response
  const { id, action, entityId, entityName, entityType } = parsed.value

  const item = await prisma.atoMatchReview.findUnique({ where: { id } })
  if (!item) return fail('Review item not found', 404)

  if (action === 'IGNORE') {
    await prisma.atoMatchReview.update({ where: { id }, data: { status: 'IGNORED' } })
    return ok({ id, status: 'IGNORED' })
  }

  if (action === 'REOPEN') {
    await prisma.atoMatchReview.update({
      where: { id },
      data: { status: 'PENDING', resolvedEntityId: null },
    })
    return ok({ id, status: 'PENDING' })
  }

  let targetEntityId = entityId ?? null

  if (action === 'CREATE_ENTITY') {
    // The common case for the big CSPs: the feed names a company we simply
    // don't track yet (there is no bare "Amazon" entity, only "Amazon Alexa
    // Fund"). Creating it here is the correct resolution, not a workaround.
    const name = entityName?.trim() || item.sourceName
    const slug = slugify(name)

    const existing = await prisma.entity.findFirst({
      where: { OR: [{ slug }, { name }] },
      select: { id: true },
    })

    if (existing) {
      targetEntityId = existing.id
    } else {
      const created = await prisma.entity.create({
        data: {
          name,
          slug,
          type: entityType || 'CLOUD_INFRA',
          description: `Cloud service provider identified from the ${item.sourceType} authorization feed.`,
          alsoKnownAs: JSON.stringify([item.sourceName].filter((n) => n !== name)),
        },
        select: { id: true },
      })
      targetEntityId = created.id
    }
  }

  if (!targetEntityId) return fail('entityId is required to link', 400)

  const entity = await prisma.entity.findUnique({
    where: { id: targetEntityId },
    select: { id: true, name: true, slug: true },
  })
  if (!entity) return fail('Entity not found', 404)

  // Link every row from this source whose name normalizes to the reviewed name.
  const linked = await linkRows(item.sourceType, item.normalizedName, entity.id)

  await prisma.atoMatchReview.update({
    where: { id },
    data: { status: 'RESOLVED', resolvedEntityId: entity.id },
  })

  return ok({ id, status: 'RESOLVED', entity, linked })
}

async function linkRows(
  sourceType: string,
  normalizedName: string,
  entityId: string
): Promise<number> {
  // Normalization isn't expressible in SQL, so candidates are narrowed by the
  // unlinked filter and then matched in memory.
  if (sourceType === 'FEDRAMP') {
    const rows = await prisma.fedrampAuthorization.findMany({
      where: { OR: [{ entityId: null }, { entityId }] },
      select: { id: true, cspName: true },
    })
    const ids = rows.filter((r) => normalizeVendorName(r.cspName) === normalizedName).map((r) => r.id)
    if (ids.length === 0) return 0
    const res = await prisma.fedrampAuthorization.updateMany({
      where: { id: { in: ids } },
      data: { entityId },
    })
    return res.count
  }

  if (sourceType === 'DOD_PA') {
    const rows = await prisma.dodProvisionalAuth.findMany({
      where: { OR: [{ entityId: null }, { entityId }] },
      select: { id: true, cspName: true },
    })
    const ids = rows.filter((r) => normalizeVendorName(r.cspName) === normalizedName).map((r) => r.id)
    if (ids.length === 0) return 0
    const res = await prisma.dodProvisionalAuth.updateMany({
      where: { id: { in: ids } },
      data: { entityId },
    })
    return res.count
  }

  const rows = await prisma.emassAuthorization.findMany({
    where: { OR: [{ entityId: null }, { entityId }] },
    select: { id: true, cloudProvider: true, systemName: true },
  })
  const ids = rows
    .filter((r) => normalizeVendorName(r.cloudProvider || r.systemName) === normalizedName)
    .map((r) => r.id)
  if (ids.length === 0) return 0
  const res = await prisma.emassAuthorization.updateMany({
    where: { id: { in: ids } },
    data: { entityId },
  })
  return res.count
}

function safeSuggestions(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
