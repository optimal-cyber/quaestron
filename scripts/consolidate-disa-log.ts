import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * One-time cleanup of the split DISA sync-log rows.
 *
 *   npm run fix:disa-log            # dry run
 *   npm run fix:disa-log -- --apply
 *
 * One pipeline was writing two AtoSyncLog rows: 'disa' carried the sync result
 * while 'disa-xlsx' carried the cached DCAS publish date. The 'disa-xlsx' row
 * kept its 2026-03-14 timestamp forever, so check:sync graded it 144 days
 * overdue and reported FAIL on a night the sync had actually succeeded.
 *
 * Moves the cursor onto 'disa' and deletes 'disa-xlsx'. The cursor is the only
 * value worth keeping — losing it would make the next run re-probe the full
 * 120-day window instead of stopping at the known-good date.
 *
 * Nothing here touches DodProvisionalAuth.source, which legitimately remains
 * 'disa-xlsx': that records where a row came from, not which pipeline last ran.
 */

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}
const client = createClient({ url, authToken })
const apply = process.argv.includes('--apply')

async function main() {
  const res = await client.execute(
    "SELECT id, source, status, lastSyncAt, cursor, recordsAdded, recordsUpdated, recordsFailed FROM AtoSyncLog WHERE source IN ('disa', 'disa-xlsx')"
  )
  const rows = res.rows as unknown as Array<{
    id: string; source: string; status: string; lastSyncAt: string | null; cursor: string | null
    recordsAdded: number; recordsUpdated: number; recordsFailed: number
  }>

  console.log('\ncurrent rows:')
  for (const r of rows) {
    console.log(`  ${r.source.padEnd(11)} ${String(r.status).padEnd(8)} ${r.lastSyncAt}  cursor=${r.cursor ?? 'NULL'}`)
  }

  const legacy = rows.find((r) => r.source === 'disa-xlsx')
  const current = rows.find((r) => r.source === 'disa')

  if (!legacy) {
    console.log('\nNothing to do — no disa-xlsx row.')
    client.close()
    return
  }

  // Keep whichever cursor exists; the legacy row is where the probe wrote it.
  const cursor = current?.cursor ?? legacy.cursor
  console.log(`\nplan:`)
  if (current) {
    console.log(`  set disa.cursor = ${cursor ?? 'NULL'}${current.cursor !== cursor ? '  (adopted from disa-xlsx)' : '  (already correct)'}`)
    console.log(`  delete the disa-xlsx row`)
  } else {
    // No sync has logged under the new key yet; rename rather than delete, so
    // the publish-date cache survives.
    console.log(`  rename disa-xlsx -> disa (no disa row exists yet)`)
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing written.\n')
    client.close()
    return
  }

  mkdirSync('.backfill', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = `.backfill/disa-log-${stamp}.json`
  writeFileSync(path, JSON.stringify({ takenAt: stamp, rows }, null, 2))
  console.log(`\nSnapshot: ${path}`)

  if (current) {
    if (cursor !== current.cursor) {
      await client.execute({
        sql: 'UPDATE AtoSyncLog SET cursor = ? WHERE source = ?',
        args: [cursor, 'disa'],
      })
    }
    await client.execute({ sql: 'DELETE FROM AtoSyncLog WHERE source = ?', args: ['disa-xlsx'] })
  } else {
    await client.execute({
      sql: 'UPDATE AtoSyncLog SET source = ? WHERE source = ?',
      args: ['disa', 'disa-xlsx'],
    })
  }

  const after = await client.execute(
    "SELECT source, status, lastSyncAt, cursor FROM AtoSyncLog WHERE source IN ('disa', 'disa-xlsx')"
  )
  console.log('\nafter:')
  for (const r of after.rows as any[]) {
    console.log(`  ${String(r.source).padEnd(11)} ${String(r.status).padEnd(8)} ${r.lastSyncAt}  cursor=${r.cursor ?? 'NULL'}`)
  }
  client.close()
}

main().catch((err) => {
  console.error('Consolidation failed:', err)
  process.exit(1)
})
