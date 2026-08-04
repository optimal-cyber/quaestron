import 'dotenv/config'
import { prisma } from '../lib/db'
import { normalizeVendorName } from '../lib/match/vendor-name'
import { buildMatcherIndex, matchAtoName, type MatcherIndex } from '../lib/match/ato-entity'

/**
 * Links FedRAMP / DoD PA / eMASS rows to Entity rows, and files everything it
 * couldn't resolve into AtoMatchReview for an operator to handle in /admin.
 *
 *   npm run backfill:ato-entities            # link unlinked rows
 *   npm run backfill:ato-entities -- --all   # re-evaluate every row
 *   npm run backfill:ato-entities -- --dry   # report only, write nothing
 *
 * Idempotent: re-running only touches rows whose resolved entity changed.
 * Targets whatever TURSO_DATABASE_URL points at — blank it to hit local dev.db.
 */

interface SourceRow {
  id: string
  name: string
  currentEntityId: string | null
}

interface SourceSpec {
  type: 'FEDRAMP' | 'DOD_PA' | 'EMASS'
  label: string
  load: (onlyUnlinked: boolean) => Promise<SourceRow[]>
  link: (id: string, entityId: string | null) => Promise<unknown>
}

const SOURCES: SourceSpec[] = [
  {
    type: 'FEDRAMP',
    label: 'FedRAMP',
    load: async (onlyUnlinked) => {
      const rows = await prisma.fedrampAuthorization.findMany({
        where: onlyUnlinked ? { entityId: null } : {},
        select: { id: true, cspName: true, entityId: true },
      })
      return rows.map((r) => ({ id: r.id, name: r.cspName, currentEntityId: r.entityId }))
    },
    link: (id, entityId) =>
      prisma.fedrampAuthorization.update({ where: { id }, data: { entityId } }),
  },
  {
    type: 'DOD_PA',
    label: 'DoD PA',
    load: async (onlyUnlinked) => {
      const rows = await prisma.dodProvisionalAuth.findMany({
        where: onlyUnlinked ? { entityId: null } : {},
        select: { id: true, cspName: true, entityId: true },
      })
      return rows.map((r) => ({ id: r.id, name: r.cspName, currentEntityId: r.entityId }))
    },
    link: (id, entityId) =>
      prisma.dodProvisionalAuth.update({ where: { id }, data: { entityId } }),
  },
  {
    type: 'EMASS',
    label: 'eMASS',
    load: async (onlyUnlinked) => {
      const rows = await prisma.emassAuthorization.findMany({
        where: onlyUnlinked ? { entityId: null } : {},
        select: { id: true, cloudProvider: true, systemName: true, entityId: true },
      })
      // eMASS rows are systems, not vendors. cloudProvider is the vendor when
      // present; systemName is a weak fallback and often names the program
      // rather than the company, so it frequently lands in the review queue.
      return rows.map((r) => ({
        id: r.id,
        name: r.cloudProvider || r.systemName,
        currentEntityId: r.entityId,
      }))
    },
    link: (id, entityId) =>
      prisma.emassAuthorization.update({ where: { id }, data: { entityId } }),
  },
]

interface Stats {
  scanned: number
  linked: number
  unchanged: number
  unresolved: number
  reviewItems: number
}

async function processSource(
  spec: SourceSpec,
  index: MatcherIndex,
  options: { onlyUnlinked: boolean; dryRun: boolean }
): Promise<Stats> {
  const stats: Stats = { scanned: 0, linked: 0, unchanged: 0, unresolved: 0, reviewItems: 0 }
  const rows = await spec.load(options.onlyUnlinked)
  stats.scanned = rows.length

  // Resolve once per distinct name, not once per row — a CSP with 40 offerings
  // is one matching decision.
  const byName = new Map<string, SourceRow[]>()
  for (const row of rows) {
    const key = row.name?.trim() || ''
    if (!key) continue
    const list = byName.get(key)
    if (list) list.push(row)
    else byName.set(key, [row])
  }

  for (const [name, group] of byName) {
    const result = matchAtoName(index, name)

    if (result.match) {
      for (const row of group) {
        if (row.currentEntityId === result.match.entityId) {
          stats.unchanged++
          continue
        }
        if (!options.dryRun) await spec.link(row.id, result.match.entityId)
        stats.linked++
      }

      // A previously-unresolved name that now matches shouldn't linger as an
      // open review item.
      if (!options.dryRun) {
        await prisma.atoMatchReview.updateMany({
          where: {
            sourceType: spec.type,
            normalizedName: normalizeVendorName(name),
            status: 'PENDING',
          },
          data: { status: 'RESOLVED', resolvedEntityId: result.match.entityId },
        })
      }
      continue
    }

    stats.unresolved += group.length
    stats.reviewItems++

    if (options.dryRun) continue

    const normalized = normalizeVendorName(name)
    const payload = {
      sourceName: name,
      recordCount: group.length,
      suggestions: JSON.stringify(result.suggestions),
      lastSeenAt: new Date(),
    }

    await prisma.atoMatchReview.upsert({
      where: { sourceType_normalizedName: { sourceType: spec.type, normalizedName: normalized } },
      create: { sourceType: spec.type, normalizedName: normalized, ...payload },
      // Deliberately does not reset `status`: a name an operator already marked
      // IGNORED must stay ignored across re-runs.
      update: payload,
    })
  }

  return stats
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry')
  const onlyUnlinked = !args.includes('--all')

  console.log(`Target database: ${process.env.TURSO_DATABASE_URL || 'file:dev.db'}`)
  console.log(`Mode: ${onlyUnlinked ? 'unlinked rows only' : 'all rows'}${dryRun ? ' (DRY RUN)' : ''}\n`)

  const index = await buildMatcherIndex()
  console.log(`Indexed ${index.entities.length} entities\n`)

  const totals: Stats = { scanned: 0, linked: 0, unchanged: 0, unresolved: 0, reviewItems: 0 }

  for (const spec of SOURCES) {
    const stats = await processSource(spec, index, { onlyUnlinked, dryRun })
    console.log(
      `${spec.label.padEnd(8)} scanned=${stats.scanned} linked=${stats.linked} ` +
        `unchanged=${stats.unchanged} unresolved=${stats.unresolved} reviewItems=${stats.reviewItems}`
    )
    totals.scanned += stats.scanned
    totals.linked += stats.linked
    totals.unchanged += stats.unchanged
    totals.unresolved += stats.unresolved
    totals.reviewItems += stats.reviewItems
  }

  console.log(
    `\nTOTAL    scanned=${totals.scanned} linked=${totals.linked} ` +
      `unchanged=${totals.unchanged} unresolved=${totals.unresolved} reviewItems=${totals.reviewItems}`
  )

  if (totals.reviewItems > 0 && !dryRun) {
    console.log(`\n${totals.reviewItems} name(s) need manual review — see /admin.`)
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
