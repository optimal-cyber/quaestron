import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiRequireTier } from '@/lib/auth'
import { parseQuery } from '@/lib/api/response'
import { buildExport, exportResponse, cell } from '@/lib/export/build'

const querySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  entitySlug: z.string().trim().max(160).optional(),
  agency: z.string().trim().max(160).optional(),
  minValue: z.coerce.number().min(0).optional(),
  since: z.string().trim().max(20).optional(),
})

const MAX_ROWS = 5000

/** Pro-gated export of federal contract awards. */
export async function GET(request: Request) {
  const guard = await apiRequireTier('PRO')
  if (!guard.ok) return guard.response

  const parsed = parseQuery(querySchema, new URL(request.url))
  if (!parsed.ok) return parsed.response
  const { format, entitySlug, agency, minValue, since } = parsed.value

  let entityId: string | undefined
  if (entitySlug) {
    const entity = await prisma.entity.findFirst({
      where: { OR: [{ slug: entitySlug }, { id: entitySlug }] },
      select: { id: true },
    })
    entityId = entity?.id
  }

  const sinceDate = since ? new Date(since) : null
  const validSince = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null

  const rows = await prisma.contract.findMany({
    where: {
      ...(entityId ? { entityId } : {}),
      ...(minValue ? { value: { gte: minValue } } : {}),
      ...(validSince ? { awardDate: { gte: validSince } } : {}),
      ...(agency ? { agency: { name: { contains: agency } } } : {}),
    },
    select: {
      awardId: true,
      description: true,
      value: true,
      awardDate: true,
      endDate: true,
      naicsCode: true,
      psc: true,
      placeOfPerformance: true,
      sbirProgram: true,
      sbirPhase: true,
      sbirAgency: true,
      entity: { select: { name: true, slug: true } },
      agency: { select: { name: true } },
    },
    orderBy: { value: 'desc' },
    take: MAX_ROWS,
  })

  type Row = (typeof rows)[number]

  const built = buildExport<Row>(
    {
      name: 'contracts',
      rows,
      columns: [
        { header: 'Vendor', value: (r) => r.entity.name },
        { header: 'Vendor slug', value: (r) => r.entity.slug },
        { header: 'Award ID', value: (r) => cell(r.awardId) },
        { header: 'Agency', value: (r) => cell(r.agency?.name ?? null) },
        { header: 'Value (USD)', value: (r) => cell(r.value) },
        { header: 'Award date', value: (r) => cell(r.awardDate?.toISOString().slice(0, 10) ?? null) },
        { header: 'End date', value: (r) => cell(r.endDate?.toISOString().slice(0, 10) ?? null) },
        { header: 'NAICS', value: (r) => cell(r.naicsCode) },
        { header: 'PSC', value: (r) => cell(r.psc) },
        { header: 'Place of performance', value: (r) => cell(r.placeOfPerformance) },
        { header: 'SBIR program', value: (r) => cell(r.sbirProgram) },
        { header: 'SBIR phase', value: (r) => cell(r.sbirPhase) },
        { header: 'SBIR agency', value: (r) => cell(r.sbirAgency) },
        { header: 'Description', value: (r) => cell(r.description) },
      ],
      caveats: [
        'Source: USASpending.gov awards and SBIR.gov SBIR/STTR awards, as ingested by Iron Echelon.',
        'A blank value means the field was absent in the source record, not zero.',
        rows.length === MAX_ROWS
          ? `NOTE: capped at ${MAX_ROWS} rows. Narrow the filters for a complete set.`
          : '',
      ].filter(Boolean),
    },
    format
  )

  return exportResponse(built)
}
