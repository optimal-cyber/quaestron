import 'dotenv/config'
import { createClient } from '@libsql/client'

/**
 * Phase 5 — indexes for the query patterns added in Phases 2–4.
 *
 *   npm run migrate:turso:indexes
 *
 * `Contract` had no indexes at all despite being filtered by entityId on the
 * vendor dossier, the crosswalk, the analyst tools, and every export, and
 * scanned by createdAt on every cron run.
 *
 * Index creation is online in SQLite/LibSQL and these tables are small, so this
 * is safe to run against a live database. Purely additive and re-runnable.
 */

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

const indexes = [
  'CREATE INDEX IF NOT EXISTS Contract_entityId_idx ON Contract(entityId)',
  'CREATE INDEX IF NOT EXISTS Contract_agencyId_idx ON Contract(agencyId)',
  'CREATE INDEX IF NOT EXISTS Contract_createdAt_idx ON Contract(createdAt)',
  'CREATE INDEX IF NOT EXISTS Contract_value_idx ON Contract(value)',
  'CREATE INDEX IF NOT EXISTS Contract_sbirProgram_idx ON Contract(sbirProgram)',
  'CREATE INDEX IF NOT EXISTS NewsItem_createdAt_idx ON NewsItem(createdAt)',
  'CREATE INDEX IF NOT EXISTS NewsItem_publishedAt_idx ON NewsItem(publishedAt)',
]

async function migrate() {
  console.log(`Connecting to: ${url}`)

  for (const sql of indexes) {
    const indexName = sql.match(/INDEX IF NOT EXISTS (\w+)/)?.[1]
    try {
      await client.execute(sql)
      console.log(`  ✓ Index ${indexName} ready`)
    } catch (err) {
      console.error(`  ✗ Index ${indexName} failed:`, err)
    }
  }

  console.log('\nDone.')
  client.close()
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
