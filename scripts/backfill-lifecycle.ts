import 'dotenv/config'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * One-time lifecycle backfill for the orphaned FedRAMP rows.
 *
 *   npm run backfill:lifecycle -- --dry-run     # default; changes nothing
 *   npm run backfill:lifecycle -- --apply
 *   npm run backfill:lifecycle -- --revert
 *
 * Every write is preceded by a snapshot of the affected rows' prior state to
 * .backfill/lifecycle-<timestamp>.json, and --revert replays it. Ten Authorized
 * rows is small enough that being able to undo beats the convenience of not
 * bothering — and a row wrongly marked withdrawn tells a user a vendor lost its
 * authorization, which is the most damaging thing this product can say.
 *
 * SOURCE OF TRUTH: FedRAMP/marketplace-fedramp-gov-data (the live repo), NOT
 * the GSA mirror the ingest currently reads. The mirror stopped updating on
 * 2026-05-19 and absence from a dead file proves nothing.
 */

const LIVE_URL =
  'https://raw.githubusercontent.com/FedRAMP/marketplace-fedramp-gov-data/main/data.json'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}
const client = createClient({ url, authToken })

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const revert = args.includes('--revert')

interface Snapshot {
  takenAt: string
  source: string
  rows: Array<{
    packageId: string
    lifecycleState: string | null
    supersededByPackageId: string | null
  }>
}

/**
 * Confirmed re-keys. Each was verified by locating the commit in which the old
 * id left the feed and finding the replacement present under the same vendor
 * and service, then re-checked against the live file.
 *
 * Deliberately a hand-checked constant, not a similarity search. The same
 * threshold that correctly matched Palantir also matched "FormAssembly Gov
 * Cloud" to "18F Cloud.gov" purely on the words "gov" and "cloud". Anything not
 * on this list goes to AtoMatchReview instead of being guessed at.
 */
const CONFIRMED_SUPERSEDED: Record<string, string> = {
  FR1912671248: 'FR2434554673', // Palantir Federal Cloud Service
  FR2023864279: 'FR2023864279A', // Datadog for Government
  F1403283529: 'F1403283529A', // Project Hosts GSS One - Azure
}

/**
 * Uncertain: the vendor is still present but this specific offering is not, and
 * the nearest candidate is a different product. Queued for human review rather
 * than linked.
 */
const NEEDS_REVIEW = ['FR2431252785'] // Splunk Observability Cloud

async function fetchLiveIds(): Promise<Set<string>> {
  const res = await fetch(LIVE_URL, { signal: AbortSignal.timeout(90_000) })
  if (!res.ok) throw new Error(`live feed fetch failed: ${res.status}`)
  const json = await res.json()
  const products = json?.data?.Products ?? []
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('live feed returned no products — refusing to reconcile against an empty set')
  }
  console.log(`Live feed: ${products.length} products, last_change ${json?.meta?.last_change}`)
  return new Set(products.map((p: { id: unknown }) => String(p.id)))
}

async function doRevert() {
  const path = args[args.indexOf('--revert') + 1]
  if (!path || !existsSync(path)) {
    console.error('Usage: --revert <path to .backfill/lifecycle-*.json>')
    process.exit(1)
  }
  const snap: Snapshot = JSON.parse(readFileSync(path, 'utf8'))
  console.log(`Reverting ${snap.rows.length} rows to their state at ${snap.takenAt}`)
  for (const r of snap.rows) {
    await client.execute({
      sql: 'UPDATE FedrampAuthorization SET lifecycleState = ?, supersededByPackageId = ? WHERE packageId = ?',
      args: [r.lifecycleState ?? 'ACTIVE', r.supersededByPackageId, r.packageId],
    })
  }
  console.log('Reverted.')
}

async function main() {
  if (revert) {
    await doRevert()
    client.close()
    return
  }

  const liveIds = await fetchLiveIds()
  const rows = await client.execute(
    'SELECT packageId, cspName, csoName, status, lifecycleState, supersededByPackageId FROM FedrampAuthorization'
  )

  const orphans = rows.rows.filter((r) => !liveIds.has(String(r.packageId)))
  console.log(`\n${orphans.length} rows absent from the live feed\n`)

  const plan: Array<{ packageId: string; from: string; to: string; supersededBy: string | null; label: string }> = []
  for (const r of orphans) {
    const pid = String(r.packageId)
    const current = String(r.lifecycleState ?? 'ACTIVE')
    if (current === 'SUPERSEDED') continue // already resolved by a human

    const supersededBy = CONFIRMED_SUPERSEDED[pid] ?? null
    const to = supersededBy ? 'SUPERSEDED' : 'WITHDRAWN_UPSTREAM'
    if (current === to) continue

    plan.push({
      packageId: pid,
      from: current,
      to,
      supersededBy,
      label: `${r.cspName} — ${r.csoName} [${r.status}]`,
    })
  }

  for (const p of plan) {
    const arrow = p.supersededBy ? ` -> ${p.supersededBy}` : ''
    console.log(`  ${p.to === 'SUPERSEDED' ? '↻' : '✗'} ${p.packageId.padEnd(15)} ${p.to}${arrow}`)
    console.log(`      ${p.label}`)
  }

  const review = NEEDS_REVIEW.filter((id) => rows.rows.some((r) => String(r.packageId) === id))
  if (review.length) {
    console.log(`\n  ${review.length} queued for AtoMatchReview rather than linked: ${review.join(', ')}`)
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to commit ${plan.length} change(s).`)
    client.close()
    return
  }

  // Snapshot BEFORE writing, so a revert is always possible.
  const snap: Snapshot = {
    takenAt: new Date().toISOString(),
    source: LIVE_URL,
    rows: plan.map((p) => {
      const row = rows.rows.find((r) => String(r.packageId) === p.packageId)
      return {
        packageId: p.packageId,
        lifecycleState: row?.lifecycleState ? String(row.lifecycleState) : 'ACTIVE',
        supersededByPackageId: row?.supersededByPackageId ? String(row.supersededByPackageId) : null,
      }
    }),
  }
  const path = `.backfill/lifecycle-${snap.takenAt.replace(/[:.]/g, '-')}.json`
  writeFileSync(path, JSON.stringify(snap, null, 2))
  console.log(`\nSnapshot written: ${path}`)

  for (const p of plan) {
    await client.execute({
      sql: 'UPDATE FedrampAuthorization SET lifecycleState = ?, supersededByPackageId = ? WHERE packageId = ?',
      args: [p.to, p.supersededBy, p.packageId],
    })
  }
  console.log(`Applied ${plan.length} change(s).`)
  console.log(`Revert with: npm run backfill:lifecycle -- --revert ${path}`)
  client.close()
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
