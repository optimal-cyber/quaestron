import 'dotenv/config'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * Hand-corrected entity types for the highest-spend vendors.
 *
 *   npm run fix:types            # dry run
 *   npm run fix:types -- --apply
 *   npm run fix:types -- --revert <snapshot>
 *
 * /vendors sorts by federal obligations, so these are the first rows any
 * diligence buyer sees, and eight of the top twenty were visibly wrong to
 * anyone who knows the industry: Lockheed Martin and Northrop Grumman filed as
 * INVESTOR, General Dynamics as SURVEILLANCE, BAE and L3Harris as AI_ML.
 *
 * Hand-assigned rather than inferred. The types came from Surveillance Watch's
 * own taxonomy, which classifies by why THEY track a company, not by what the
 * company is — and no heuristic recovers the difference. A short reviewed list
 * beats a clever rule here, and the list is short precisely because the tail
 * does not appear on the first screen.
 */

const RETYPE: Array<{ slug: string; to: string; why: string }> = [
  // Primes filed as investors, because the Surveillance Watch import treated
  // any company appearing in a funding relationship as a funder.
  { slug: 'lockheed-martin', to: 'DEFENSE_PRIME', why: 'largest US defense prime, filed as INVESTOR' },
  { slug: 'northrop-grumman-corporation', to: 'DEFENSE_PRIME', why: 'defense prime, filed as INVESTOR' },

  // Primes filed by the thing that got them tracked rather than what they are.
  { slug: 'general-dynamics', to: 'DEFENSE_PRIME', why: 'defense prime, filed as SURVEILLANCE' },
  { slug: 'bae-systems', to: 'DEFENSE_PRIME', why: 'defense prime, filed as AI_ML' },
  { slug: 'leidos', to: 'DEFENSE_PRIME', why: 'defense/IT services prime, filed as AI_ML' },
  { slug: 'l3harris', to: 'DEFENSE_PRIME', why: 'defense prime, filed as AI_ML' },
  { slug: 'anduril', to: 'DEFENSE_PRIME', why: 'builds autonomous weapons systems; AI_ML understates it' },

  // Consultancies filed as technology vendors.
  { slug: 'booz-allen-hamilton', to: 'CONSULTANCY', why: 'management consultancy, filed as AI_ML' },
  { slug: 'accenture-federal-services', to: 'CONSULTANCY', why: 'consultancy, filed as CLOUD_INFRA' },

  // Technology vendors filed as primes, or in the wrong technology bucket.
  { slug: 'amazon-web-services', to: 'CLOUD_INFRA', why: 'cloud provider, filed as DEFENSE_PRIME' },
  { slug: 'splunk-llc', to: 'CYBER_INTEL', why: 'security analytics, filed as CLOUD_INFRA' },
]

/**
 * NOT retyped, and deliberately so.
 *
 * These three are correctly typed INVESTOR for what they are — the problem is
 * that federal contracts are attached to them, which is an attribution bug, not
 * a taxonomy one. Retyping would hide it: "Boeing HorizonX Ventures" would stop
 * looking odd while still claiming $467.8B of Boeing's awards.
 *
 * Boeing and Microsoft have no parent record at all, so the contracts cannot
 * simply be moved — a parent has to be created first. Lockheed Martin Ventures
 * is different: the parent exists and holds its own 289 contracts, so its 237
 * are straightforwardly reassignable. All three need review, not a script.
 */
const ATTRIBUTION_REVIEW = [
  'boeing-horizonx-ventures',
  'microsoft-accelerator-london',
  'lockheed-martin-ventures',
]

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

async function doRevert() {
  const path = args[args.indexOf('--revert') + 1]
  if (!path || !existsSync(path)) {
    console.error('Usage: --revert <path to .backfill/entity-types-*.json>')
    process.exit(1)
  }
  const snap = JSON.parse(readFileSync(path, 'utf8'))
  for (const r of snap.rows) {
    await client.execute({ sql: 'UPDATE Entity SET type = ? WHERE id = ?', args: [r.type, r.id] })
  }
  console.log(`Reverted ${snap.rows.length} entity type(s).`)
}

async function main() {
  if (revert) {
    await doRevert()
    client.close()
    return
  }

  const res = await client.execute({
    sql: `SELECT id, name, slug, type, totalFederalObligated FROM Entity WHERE slug IN (${RETYPE.map(() => '?').join(',')})`,
    args: RETYPE.map((r) => r.slug),
  })
  const bySlug = new Map(
    (res.rows as unknown as Array<{ id: string; name: string; slug: string; type: string; totalFederalObligated: number | null }>)
      .map((e) => [e.slug, e])
  )

  const plan: Array<{ id: string; slug: string; name: string; from: string; to: string; why: string }> = []
  const missing: string[] = []
  let already = 0

  for (const r of RETYPE) {
    const e = bySlug.get(r.slug)
    if (!e) { missing.push(r.slug); continue }
    if (e.type === r.to) { already++; continue }
    plan.push({ id: e.id, slug: r.slug, name: e.name, from: e.type, to: r.to, why: r.why })
  }

  console.log(`\n${plan.length} retype(s), ${already} already correct${missing.length ? `, ${missing.length} not found: ${missing.join(', ')}` : ''}\n`)
  for (const p of plan) {
    console.log(`  ${p.name}`)
    console.log(`     ${p.from} -> ${p.to}   (${p.why})`)
  }

  const review = await client.execute({
    sql: `SELECT name, type, totalFederalObligated, (SELECT COUNT(*) FROM Contract c WHERE c.entityId = e.id) n
          FROM Entity e WHERE slug IN (${ATTRIBUTION_REVIEW.map(() => '?').join(',')})`,
    args: ATTRIBUTION_REVIEW,
  })
  console.log(`\nNOT retyped — attribution review, correctly typed INVESTOR:`)
  for (const r of review.rows as any[]) {
    const v = r.totalFederalObligated ? `$${(Number(r.totalFederalObligated) / 1e9).toFixed(1)}B` : '—'
    console.log(`  ${String(r.name).padEnd(32)} ${v.padStart(9)}  ${r.n} contracts`)
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing written.\n`)
    client.close()
    return
  }

  mkdirSync('.backfill', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = `.backfill/entity-types-${stamp}.json`
  writeFileSync(path, JSON.stringify({ takenAt: stamp, rows: plan.map((p) => ({ id: p.id, slug: p.slug, type: p.from })) }, null, 2))
  console.log(`\nSnapshot: ${path}`)

  for (const p of plan) {
    await client.execute({ sql: 'UPDATE Entity SET type = ? WHERE id = ?', args: [p.to, p.id] })
  }
  console.log(`Applied ${plan.length} retype(s).`)
  console.log(`Revert:   npm run fix:types -- --revert ${path}`)
  client.close()
}

main().catch((err) => {
  console.error('Retype failed:', err)
  process.exit(1)
})
