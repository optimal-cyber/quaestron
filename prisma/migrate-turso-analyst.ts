import 'dotenv/config'
import { createClient } from '@libsql/client'

/**
 * Phase 4 — AI analyst thread persistence.
 *
 *   npm run migrate:turso:analyst
 *
 * Purely additive; safe to re-run. Requires the Phase 1 auth tables (User).
 * The Free-tier daily message cap reuses the existing RateLimit table rather
 * than adding a counter of its own.
 */

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

const tables = [
  `CREATE TABLE IF NOT EXISTS AnalystThread (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New thread',
    entitySlug TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS AnalystMessage (
    id TEXT PRIMARY KEY,
    threadId TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    toolCalls TEXT NOT NULL DEFAULT '[]',
    stopReason TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (threadId) REFERENCES AnalystThread(id) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
]

const indexes = [
  'CREATE INDEX IF NOT EXISTS AnalystThread_userId_updatedAt_idx ON AnalystThread(userId, updatedAt)',
  'CREATE INDEX IF NOT EXISTS AnalystMessage_threadId_createdAt_idx ON AnalystMessage(threadId, createdAt)',
]

async function migrate() {
  console.log(`Connecting to: ${url}`)

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

  console.log('\nDone.')
  client.close()
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
