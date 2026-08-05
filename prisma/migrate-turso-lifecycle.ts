import 'dotenv/config'
import { createClient } from '@libsql/client'

/**
 * Lifecycle columns on FedrampAuthorization.
 *
 *   npm run migrate:turso:lifecycle
 *
 * Additive and idempotent, like the other Turso migrations: SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so existence is checked via PRAGMA table_info.
 *
 * Every existing row defaults to ACTIVE. That is deliberately optimistic and
 * deliberately wrong for the known orphans — correcting those is the backfill's
 * job (`npm run backfill:lifecycle`), which records prior state so it can be
 * reverted. Defaulting to WITHDRAWN_UPSTREAM instead would assert that 36
 * offerings left the marketplace on the strength of a migration script.
 */

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

const columns = [
  { table: 'FedrampAuthorization', column: 'lifecycleState', definition: "TEXT NOT NULL DEFAULT 'ACTIVE'" },
  { table: 'FedrampAuthorization', column: 'supersededByPackageId', definition: 'TEXT' },
  { table: 'FedrampAuthorization', column: 'lastSeenUpstreamAt', definition: 'DATETIME' },
]

const indexes = [
  'CREATE INDEX IF NOT EXISTS FedrampAuthorization_lifecycleState_idx ON FedrampAuthorization(lifecycleState)',
  // The reconciliation sweep filters on state and the UI filters on state+status.
  'CREATE INDEX IF NOT EXISTS FedrampAuthorization_lifecycle_status_idx ON FedrampAuthorization(lifecycleState, status)',
]

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await client.execute(`PRAGMA table_info(${table})`)
  return result.rows.some((row) => String(row.name) === column)
}

async function migrate() {
  console.log(`Connecting to: ${url}`)

  for (const { table, column, definition } of columns) {
    try {
      if (await columnExists(table, column)) {
        console.log(`  = Column ${table}.${column} already present`)
        continue
      }
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
      console.log(`  ✓ Column ${table}.${column} added`)
    } catch (err) {
      console.error(`  ✗ Column ${table}.${column} failed:`, err)
    }
  }

  for (const sql of indexes) {
    const name = sql.match(/INDEX IF NOT EXISTS (\w+)/)?.[1]
    try {
      await client.execute(sql)
      console.log(`  ✓ Index ${name} ready`)
    } catch (err) {
      console.error(`  ✗ Index ${name} failed:`, err)
    }
  }

  const counts = await client.execute(
    'SELECT lifecycleState, COUNT(*) AS n FROM FedrampAuthorization GROUP BY lifecycleState'
  )
  console.log('\nLifecycle distribution:')
  for (const row of counts.rows) console.log(`  ${row.lifecycleState}: ${row.n}`)

  console.log('\nDone. Next: npm run backfill:lifecycle -- --dry-run')
  client.close()
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
