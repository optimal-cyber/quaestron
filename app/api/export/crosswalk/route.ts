import { z } from 'zod'
import { apiRequireTier } from '@/lib/auth'
import { fail, parseQuery } from '@/lib/api/response'
import { buildCrosswalk } from '@/lib/compliance/crosswalk'
import { buildExport, exportResponse, cell, joinCell } from '@/lib/export/build'

const querySchema = z.object({
  entity: z.string().trim().min(1).max(160),
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
})

/**
 * Pro-gated export of one vendor's full crosswalk.
 *
 * Flattened to a single sheet with a `Section` column rather than one sheet per
 * section: the rows are heterogeneous, and a CSV has no concept of multiple
 * sheets — a single shape keeps the two formats identical.
 */
interface FlatRow {
  section: string
  item: string
  detail: string | null
  level: string | null
  status: string | null
  agency: string | null
  date: string | null
  value: number | null
  note: string | null
}

export async function GET(request: Request) {
  const guard = await apiRequireTier('PRO')
  if (!guard.ok) return guard.response

  const parsed = parseQuery(querySchema, new URL(request.url))
  if (!parsed.ok) return parsed.response

  const crosswalk = await buildCrosswalk(parsed.value.entity)
  if (!crosswalk) return fail('Vendor not found', 404)

  const rows: FlatRow[] = []

  rows.push({
    section: 'Identity',
    item: crosswalk.entity.name,
    detail: crosswalk.entity.type,
    level: crosswalk.authorizations.summary.highestImpactLevel,
    status: null,
    agency: crosswalk.spend.primaryAgency,
    date: null,
    value: crosswalk.spendDataAvailable ? crosswalk.spend.totalFederalObligated : null,
    note: crosswalk.spendDataAvailable
      ? null
      : 'Spend UNKNOWN — vendor enrichment has not run. Not zero.',
  })

  for (const f of crosswalk.authorizations.fedramp) {
    rows.push({
      section: 'FedRAMP',
      item: f.csoName,
      detail: joinCell(f.serviceModel),
      level: f.impactLevel,
      status: f.status,
      agency: f.sponsoringAgency,
      date: f.expirationDate?.slice(0, 10) ?? null,
      value: null,
      note: f.matchedByName ? 'Matched by vendor name only — entity link unconfirmed' : null,
    })
  }

  for (const d of crosswalk.authorizations.dodPa) {
    rows.push({
      section: 'DoD PA',
      item: d.csoName,
      detail: null,
      level: d.impactLevel,
      status: 'Authorized',
      agency: d.sponsorComponent,
      date: d.paExpiration?.slice(0, 10) ?? null,
      value: null,
      note: d.matchedByName ? 'Matched by vendor name only — entity link unconfirmed' : null,
    })
  }

  for (const e of crosswalk.authorizations.emass) {
    rows.push({
      section: 'eMASS',
      item: e.systemName,
      detail: e.component,
      level: e.impactLevel,
      status: e.authorizationType,
      agency: e.component,
      date: e.expirationDate?.slice(0, 10) ?? null,
      value: null,
      note: e.matchedByName ? 'Matched by vendor name only — entity link unconfirmed' : null,
    })
  }

  for (const a of crosswalk.agencyLeverage) {
    rows.push({
      section: 'Agency leverage',
      item: a.agency,
      detail: a.roles.join(', '),
      level: null,
      status: null,
      agency: a.agency,
      date: null,
      value: a.totalObligated || null,
      note: `${a.authorizationCount} authorization(s), ${a.awardCount} award(s)`,
    })
  }

  for (const c of crosswalk.spend.topContracts) {
    rows.push({
      section: 'Top contracts',
      item: c.description?.slice(0, 120) ?? '(no description)',
      detail: null,
      level: null,
      status: null,
      agency: c.agency,
      date: c.awardDate?.slice(0, 10) ?? null,
      value: c.value,
      note: null,
    })
  }

  for (const [phase, stats] of Object.entries(crosswalk.sbir.byPhase)) {
    rows.push({
      section: 'SBIR',
      item: `Phase ${phase}`,
      detail: `${stats.count} award(s)`,
      level: null,
      status: null,
      agency: null,
      date: null,
      value: stats.value,
      note: null,
    })
  }

  const built = buildExport<FlatRow>(
    {
      name: `crosswalk-${crosswalk.entity.slug}`,
      rows,
      columns: [
        { header: 'Section', value: (r) => r.section },
        { header: 'Item', value: (r) => r.item },
        { header: 'Detail', value: (r) => cell(r.detail) },
        { header: 'Impact level', value: (r) => cell(r.level) },
        { header: 'Status', value: (r) => cell(r.status) },
        { header: 'Agency', value: (r) => cell(r.agency) },
        { header: 'Date', value: (r) => cell(r.date) },
        { header: 'Value (USD)', value: (r) => cell(r.value) },
        { header: 'Note', value: (r) => cell(r.note) },
      ],
      caveats: [
        `Vendor: ${crosswalk.entity.name} (${crosswalk.entity.slug})`,
        'Dates in the FedRAMP section are next annual assessment due dates, NOT hard expirations.',
        crosswalk.spendDataAvailable
          ? ''
          : 'Federal obligation figures are UNKNOWN for this vendor (enrichment has not run) and are left blank. Blank does NOT mean zero.',
        crosswalk.whitespace
          ? 'WHITESPACE: authorized to operate with no federal obligations on record.'
          : '',
      ].filter(Boolean),
    },
    parsed.value.format
  )

  return exportResponse(built)
}
