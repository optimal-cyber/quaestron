import 'dotenv/config'
import { createClient } from '@libsql/client'

/**
 * Adds the resume cursor to AtoSyncLog.
 *
 *   npm run migrate:turso:sync-cursor
 *
 * Additive and idempotent (PRAGMA guard). Must be applied BEFORE the resumable
 * daily-sync deploys: without the column, every sync write fails.
 */

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}
const client = createClient({ url, authToken })

async function columnExists(table: string, column: string): Promise<boolean> {
  const r = await client.execute(`PRAGMA table_info(${table})`)
  return r.rows.some((row) => String(row.name) === column)
}

async function migrate() {
  console.log(`Connecting to: ${url}`)
  try {
    if (await columnExists('AtoSyncLog', 'cursor')) {
      console.log('  = Column AtoSyncLog.cursor already present')
    } else {
      await client.execute('ALTER TABLE AtoSyncLog ADD COLUMN cursor TEXT')
      console.log('  ✓ Column AtoSyncLog.cursor added')
    }
  } catch (err) {
    console.error('  ✗ Failed:', err)
    process.exitCode = 1
  }
  console.log('\nDone.')
  client.close()
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
