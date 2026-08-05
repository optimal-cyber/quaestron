import 'dotenv/config'
import { createClient } from '@libsql/client'

/**
 * Phase 3 — entityId columns on the three ATO tables, plus the unmatched-name
 * review queue.
 *
 *   npm run migrate:turso:compliance
 *
 * Unlike the Phase 1/2 scripts this one has to add COLUMNS, and SQLite has no
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Idempotency comes from checking
 * PRAGMA table_info first, so re-running is still safe.
 *
 * Adding a nullable column rewrites no rows and takes no lock worth worrying
 * about at these table sizes. Existing rows get NULL until the backfill runs:
 *
 *   npm run backfill:ato-entities
 */

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

const columns: Array<{ table: string; column: string; definition: string }> = [
  { table: 'FedrampAuthorization', column: 'entityId', definition: 'TEXT' },
  { table: 'DodProvisionalAuth', column: 'entityId', definition: 'TEXT' },
  { table: 'EmassAuthorization', column: 'entityId', definition: 'TEXT' },
  // Captured from the FedRAMP feed in the same phase as entityId, but originally
  // omitted here — the schema declared them while this script did not, so every
  // Prisma query returning a full FedrampAuthorization row failed against a
  // migrated database ("no such column: uei"). Selects with an explicit column
  // list still worked, which is why it stayed hidden until the first write.
  { table: 'FedrampAuthorization', column: 'uei', definition: 'TEXT' },
  { table: 'FedrampAuthorization', column: 'smallBusiness', definition: 'BOOLEAN' },
]

const tables = [
  `CREATE TABLE IF NOT EXISTS AtoMatchReview (
    id TEXT PRIMARY KEY,
    sourceType TEXT NOT NULL,
    sourceName TEXT NOT NULL,
    normalizedName TEXT NOT NULL,
    recordCount INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'PENDING',
    resolvedEntityId TEXT,
    suggestions TEXT NOT NULL DEFAULT '[]',
    lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL
  )`,
]

const indexes = [
  'CREATE INDEX IF NOT EXISTS FedrampAuthorization_entityId_idx ON FedrampAuthorization(entityId)',
  'CREATE INDEX IF NOT EXISTS DodProvisionalAuth_entityId_idx ON DodProvisionalAuth(entityId)',
  'CREATE INDEX IF NOT EXISTS EmassAuthorization_entityId_idx ON EmassAuthorization(entityId)',
  'CREATE UNIQUE INDEX IF NOT EXISTS AtoMatchReview_sourceType_normalizedName_key ON AtoMatchReview(sourceType, normalizedName)',
  'CREATE INDEX IF NOT EXISTS AtoMatchReview_status_idx ON AtoMatchReview(status)',
  'CREATE INDEX IF NOT EXISTS AtoMatchReview_sourceType_idx ON AtoMatchReview(sourceType)',
  'CREATE INDEX IF NOT EXISTS FedrampAuthorization_uei_idx ON FedrampAuthorization(uei)',
  'CREATE INDEX IF NOT EXISTS FedrampAuthorization_smallBusiness_idx ON FedrampAuthorization(smallBusiness)',
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

  for (const sql of tables) {
    const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1]
    try {
      await client.execute(sql)
      console.log(`  ✓ Table ${tableName} ready`)
    } catch (err) {
      console.error(`  ✗ Table ${tableName} failed:`, err)
    }
  }

  for (const sql of indexes) {
    const indexName = sql.match(/INDEX IF NOT EXISTS (\w+)/)?.[1]
    try {
      await client.execute(sql)
      console.log(`  ✓ Index ${indexName} ready`)
    } catch (err) {
      console.error(`  ✗ Index ${indexName} failed:`, err)
    }
  }

  console.log('\nDone. Next: npm run backfill:ato-entities')
  client.close()
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
