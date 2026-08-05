import { z } from 'zod'
import { apiRequireTier } from '@/lib/auth'
import { parseQuery } from '@/lib/api/response'
import { queryUniverse, type ComplianceRow } from '@/lib/compliance/universe'
import { buildExport, exportResponse, cell, joinCell } from '@/lib/export/build'

/** Pro-gated export of the authorized-cloud universe, honouring live filters. */
const querySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  search: z.string().trim().max(120).optional(),
  impactLevel: z.string().trim().max(40).optional(),
  status: z.string().trim().max(40).optional(),
  agency: z.string().trim().max(160).optional(),
  businessSize: z.enum(['SMALL', 'OTHER']).optional(),
  setAside: z.string().trim().max(40).optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(1095).optional(),
  source: z.enum(['fedramp', 'dod-pa']).optional(),
})

/** Bounded so an export can't pull the whole table into memory unbounded. */
const MAX_ROWS = 5000

export async function GET(request: Request) {
  const guard = await apiRequireTier('PRO')
  if (!guard.ok) return guard.response

  const parsed = parseQuery(querySchema, new URL(request.url))
  if (!parsed.ok) return parsed.response
  const { format, ...filters } = parsed.value

  const result = await queryUniverse({ ...filters, sort: 'expiration', limit: MAX_ROWS, page: 1 })

  const built = buildExport<ComplianceRow>(
    {
      name: 'compliance',
      rows: result.rows,
      columns: [
        { header: 'Vendor', value: (r) => r.vendor },
        { header: 'Vendor slug', value: (r) => cell(r.entity?.slug ?? null) },
        { header: 'Offering', value: (r) => r.offering },
        { header: 'Source', value: (r) => (r.source === 'dod-pa' ? 'DoD PA' : 'FedRAMP') },
        { header: 'Impact level', value: (r) => cell(r.impactLevel) },
        { header: 'Status', value: (r) => r.status },
        { header: 'Sponsoring agency', value: (r) => cell(r.sponsoringAgency) },
        { header: 'Leveraging agencies', value: (r) => joinCell(r.leveragingAgencies) },
        { header: 'Leveraging count', value: (r) => r.leveragingCount },
        { header: 'Authorization date', value: (r) => cell(r.authorizationDate?.slice(0, 10) ?? null) },
        { header: 'Assessment due', value: (r) => cell(r.expirationDate?.slice(0, 10) ?? null) },
        { header: 'Days until assessment', value: (r) => cell(r.daysRemaining) },
        { header: 'Small business', value: (r) => (r.smallBusiness === null ? null : r.smallBusiness ? 'Yes' : 'No') },
        { header: 'Business size', value: (r) => cell(r.entity?.businessSize ?? null) },
        { header: 'Set-asides', value: (r) => joinCell(r.entity?.setAsides) },
        { header: 'Risk flags', value: (r) => joinCell(r.entity?.riskFlags) },
        {
          header: 'Total federal obligated (USD)',
          value: (r) => cell(r.entity?.totalFederalObligated ?? null),
        },
      ],
      caveats: [
        '"Assessment due" is the next FedRAMP annual assessment date, NOT a hard expiration. A FedRAMP authorization lapses only if the assessment is unmet.',
        '"Total federal obligated" is blank where vendor enrichment has not run. Blank means UNKNOWN, not zero.',
        'A blank vendor slug means the authorization has not yet been resolved to a tracked vendor, so its spend cannot be joined.',
        result.total > result.rows.length
          ? `NOTE: ${result.total} rows matched but this export is capped at ${MAX_ROWS}. Narrow the filters for a complete set.`
          : '',
      ].filter(Boolean),
    },
    format
  )

  return exportResponse(built)
}
