import 'dotenv/config'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@libsql/client'
import * as XLSX from 'xlsx'

/**
 * One-time correction of the DoD provisional authorization rows against the
 * current DCAS file.
 *
 *   npm run correct:dod-pa -- --dry-run     # default
 *   npm run correct:dod-pa -- --apply
 *   npm run correct:dod-pa -- --revert <snapshot>
 *
 * The 94 rows in production came from a hand-run seed script on 2026-03-14
 * against a spreadsheet whose filename was discarded. Four months later two of
 * them carry the wrong DoD impact level, which is the most damaging thing this
 * dataset can get wrong: an inflated IL is a claim that a system is cleared for
 * data it is not cleared for.
 *
 * Four transforms are applied in place rather than as delete+insert, because
 * (csoName, cspName, impactLevel) is the unique key — inserting the corrected
 * row first would collide, and deleting first would lose entityId resolution.
 */

const DEFAULT_DCAS =
  'https://dl.dod.cyber.mil/wp-content/uploads/cloud/xls/DCAS-Current_Authorized_CSOs-2026-07-08.xlsx'

/**
 * Same offering, changed identity. Verified by hand against the current file:
 * each old row has exactly one successor and no other candidate.
 */
const TRANSFORMS: Array<{
  match: { csp: string; cso: string; il: string }
  to: { cso?: string; il?: string }
  why: string
}> = [
  {
    match: { csp: 'Cisco Systems Inc.', cso: 'Cisco Catalyst Software Defined Wide Area Network for Defense (SDWAN-D)', il: 'IL5' },
    to: { il: 'IL4' },
    why: 'DISA lists this at IL4. We were publishing IL5 — an inflated impact level.',
  },
  {
    match: { csp: 'FedHIVE', cso: 'HRTEC', il: 'IL4' },
    to: { il: 'IL5' },
    why: 'DISA lists this at IL5. We were publishing IL4 — under-claiming.',
  },
  {
    match: { csp: 'Google', cso: 'Google Distributed Cloud Hosted (GDCH) IL6', il: 'IL6' },
    to: { cso: 'Google Distributed Cloud air-gapped  (GDCag) IL6' },
    why: 'Renamed upstream: GDCH -> GDCag.',
  },
  {
    match: { csp: 'Island.IO', cso: 'Island IL5 Use Case Testing', il: 'IL5' },
    to: { cso: 'Island Enterprise Browser SaaS IL5' },
    why: 'Renamed upstream from a testing designation to the shipped product.',
  },
]

/**
 * Absent from the current file with no successor. Marked rather than deleted:
 * they are not in the file, so deleting loses them irrecoverably.
 *
 * `source` is a provenance field, not a lifecycle one — this overloads it as a
 * stopgap until #15 adds lifecycleState, at which point these migrate to
 * WITHDRAWN_UPSTREAM. The public read paths filter on it so these stop reading
 * as current authorizations today rather than after that PR lands.
 */
const WITHDRAWN_SOURCE = 'withdrawn-pending-review'

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

const key = (csp: string, cso: string, il: string) =>
  `${csp.trim().toLowerCase()}|${cso.trim().toLowerCase()}|${il.trim().toUpperCase()}`

const normIl = (raw: string) => {
  const m = String(raw).match(/IL(\d)/i)
  return m ? `IL${m[1]}` : String(raw).trim()
}

async function currentFile() {
  const res = await fetch(process.env.DCAS_URL || DEFAULT_DCAS, { signal: AbortSignal.timeout(90_000) })
  if (!res.ok) throw new Error(`DCAS fetch failed: ${res.status}`)
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false })
  const out = rows
    .slice(1)
    .filter((r) => Array.isArray(r) && r[0])
    .map((r) => ({
      csp: String(r[0] ?? '').trim(),
      cso: String(r[1] ?? '').trim(),
      il: normIl(String(r[2] ?? '')),
      models: String(r[3] ?? '').trim(),
      status: String(r[4] ?? '').trim(),
      exp: r[5],
    }))
  if (out.length === 0) throw new Error('DCAS file parsed to zero records — refusing to reconcile')
  return out
}

function parseExp(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d)).toISOString()
  }
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d.toISOString()
}

async function doRevert() {
  const path = args[args.indexOf('--revert') + 1]
  if (!path || !existsSync(path)) {
    console.error('Usage: --revert <path to .backfill/dod-pa-*.json>')
    process.exit(1)
  }
  const snap = JSON.parse(readFileSync(path, 'utf8'))
  for (const r of snap.updated) {
    await client.execute({
      sql: 'UPDATE DodProvisionalAuth SET csoName=?, cspName=?, impactLevel=?, source=? WHERE id=?',
      args: [r.csoName, r.cspName, r.impactLevel, r.source, r.id],
    })
  }
  for (const id of snap.insertedIds) {
    await client.execute({ sql: 'DELETE FROM DodProvisionalAuth WHERE id=?', args: [id] })
  }
  console.log(`Reverted ${snap.updated.length} update(s), removed ${snap.insertedIds.length} insert(s).`)
}

async function main() {
  if (revert) {
    await doRevert()
    client.close()
    return
  }

  const live = await currentFile()
  const res = await client.execute(
    'SELECT id, csoName, cspName, impactLevel, source FROM DodProvisionalAuth'
  )
  const rows = res.rows as unknown as Array<{
    id: string; csoName: string; cspName: string; impactLevel: string; source: string
  }>

  const updated: typeof rows = []
  const plannedUpdates: Array<{ id: string; sql: string; args: unknown[]; label: string }> = []

  // 1. Transforms
  const transformedKeys = new Set<string>()
  for (const t of TRANSFORMS) {
    const row = rows.find((r) => key(r.cspName, r.csoName, r.impactLevel) === key(t.match.csp, t.match.cso, t.match.il))
    if (!row) {
      console.log(`  = already applied or absent: ${t.match.csp} / ${t.match.cso} [${t.match.il}]`)
      continue
    }
    const newCso = t.to.cso ?? row.csoName
    const newIl = t.to.il ?? row.impactLevel
    updated.push(row)
    transformedKeys.add(key(row.cspName, newCso, newIl))
    plannedUpdates.push({
      id: row.id,
      sql: 'UPDATE DodProvisionalAuth SET csoName=?, impactLevel=?, lastSynced=? WHERE id=?',
      args: [newCso, newIl, new Date().toISOString(), row.id],
      label: `${row.cspName} / ${row.csoName} [${row.impactLevel}] -> [${newIl}] ${t.to.cso ? `"${newCso}"` : ''}  (${t.why})`,
    })
  }

  // 2. Withdrawals: in production, absent from the file, and not a transform target.
  const liveKeys = new Set(live.map((l) => key(l.csp, l.cso, l.il)))
  const withdrawnRows = rows.filter((r) => {
    const k = key(r.cspName, r.csoName, r.impactLevel)
    if (liveKeys.has(k)) return false
    if (updated.some((u) => u.id === r.id)) return false // handled by a transform
    return r.source !== WITHDRAWN_SOURCE
  })
  for (const r of withdrawnRows) {
    updated.push(r)
    plannedUpdates.push({
      id: r.id,
      sql: 'UPDATE DodProvisionalAuth SET source=? WHERE id=?',
      args: [WITHDRAWN_SOURCE, r.id],
      label: `WITHDRAWN  ${r.cspName} / ${r.csoName} [${r.impactLevel}]`,
    })
  }

  // 3. Inserts: in the file, not in production, not produced by a transform.
  const prodKeys = new Set(rows.map((r) => key(r.cspName, r.csoName, r.impactLevel)))
  const inserts = live.filter((l) => {
    const k = key(l.csp, l.cso, l.il)
    return !prodKeys.has(k) && !transformedKeys.has(k)
  })

  console.log(`\ncurrent file: ${live.length} records | production: ${rows.length} rows\n`)
  console.log(`UPDATES (${plannedUpdates.length}):`)
  for (const u of plannedUpdates) console.log(`   ${u.label}`)
  console.log(`\nINSERTS (${inserts.length}):`)
  for (const i of inserts) console.log(`   + ${i.il.padEnd(4)} ${i.csp} / ${i.cso}`)

  if (!apply) {
    console.log(`\nDRY RUN — nothing written.`)
    client.close()
    return
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = `.backfill/dod-pa-${stamp}.json`
  const insertedIds: string[] = []

  // Snapshot BEFORE any write, and pre-create the directory.
  //
  // The first run of this script applied every mutation and THEN failed writing
  // the snapshot because .backfill/ did not exist, leaving production changed
  // with no revert path. Ordering the write after the mutations made the
  // rollback contingent on the very run it was meant to protect against.
  mkdirSync('.backfill', { recursive: true })
  writeFileSync(path, JSON.stringify({ takenAt: stamp, updated, insertedIds }, null, 2))

  for (const u of plannedUpdates) await client.execute({ sql: u.sql, args: u.args as never })

  for (const i of inserts) {
    const id = crypto.randomUUID()
    insertedIds.push(id)
    await client.execute({
      sql: `INSERT INTO DodProvisionalAuth
              (id, csoName, cspName, impactLevel, paDate, paExpiration, sponsorComponent, conditions, source, lastSynced, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, NULL, ?, 'DISA', ?, 'scraped', ?, ?, ?)`,
      args: [
        id, i.cso, i.csp, i.il, parseExp(i.exp),
        i.models ? `Service Models: ${i.models}${i.status ? `. Status: ${i.status}` : ''}` : i.status || null,
        new Date().toISOString(), new Date().toISOString(), new Date().toISOString(),
      ],
    })
  }

  // Rewritten now that insertedIds is populated; the pre-write above guarantees
  // a usable file exists even if this point is never reached.
  writeFileSync(path, JSON.stringify({ takenAt: stamp, updated, insertedIds }, null, 2))
  console.log(`\nApplied ${plannedUpdates.length} update(s), ${inserts.length} insert(s).`)
  console.log(`Snapshot: ${path}`)
  console.log(`Revert:   npm run correct:dod-pa -- --revert ${path}`)
  client.close()
}

main().catch((err) => {
  console.error('Correction failed:', err)
  process.exit(1)
})
