import 'dotenv/config'
import { createClient } from '@libsql/client'

/**
 * Phase 2 — watchlists, alert rules, alert events, and change snapshots.
 *
 * Purely additive: every statement is IF NOT EXISTS, so it is safe to re-run
 * and it never touches existing tables. Run after deploying the Phase 2 schema:
 *
 *   npm run migrate:turso:alerts
 *
 * Requires the Phase 1 auth tables (User) to already exist.
 */

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

const tables = [
  `CREATE TABLE IF NOT EXISTS Watchlist (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    name TEXT NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS WatchlistItem (
    id TEXT PRIMARY KEY,
    watchlistId TEXT NOT NULL,
    targetType TEXT NOT NULL,
    targetId TEXT,
    targetValue TEXT,
    targetKey TEXT NOT NULL,
    label TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (watchlistId) REFERENCES Watchlist(id) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS AlertRule (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    watchlistId TEXT,
    ruleType TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    channel TEXT NOT NULL DEFAULT 'EMAIL',
    frequency TEXT NOT NULL DEFAULT 'WEEKLY',
    active BOOLEAN NOT NULL DEFAULT true,
    lastRunAt DATETIME,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (watchlistId) REFERENCES Watchlist(id) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS AlertEvent (
    id TEXT PRIMARY KEY,
    ruleId TEXT NOT NULL,
    userId TEXT NOT NULL,
    ruleType TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    url TEXT,
    dedupeKey TEXT NOT NULL,
    entityId TEXT,
    readAt DATETIME,
    emailedAt DATETIME,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ruleId) REFERENCES AlertRule(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS AlertSnapshot (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
]

const indexes = [
  'CREATE INDEX IF NOT EXISTS Watchlist_userId_idx ON Watchlist(userId)',
  'CREATE UNIQUE INDEX IF NOT EXISTS WatchlistItem_watchlistId_targetType_targetKey_key ON WatchlistItem(watchlistId, targetType, targetKey)',
  'CREATE INDEX IF NOT EXISTS WatchlistItem_watchlistId_idx ON WatchlistItem(watchlistId)',
  'CREATE INDEX IF NOT EXISTS WatchlistItem_targetType_targetKey_idx ON WatchlistItem(targetType, targetKey)',
  'CREATE INDEX IF NOT EXISTS AlertRule_userId_idx ON AlertRule(userId)',
  'CREATE INDEX IF NOT EXISTS AlertRule_active_frequency_idx ON AlertRule(active, frequency)',
  'CREATE INDEX IF NOT EXISTS AlertRule_watchlistId_idx ON AlertRule(watchlistId)',
  'CREATE UNIQUE INDEX IF NOT EXISTS AlertEvent_dedupeKey_key ON AlertEvent(dedupeKey)',
  'CREATE INDEX IF NOT EXISTS AlertEvent_userId_readAt_idx ON AlertEvent(userId, readAt)',
  'CREATE INDEX IF NOT EXISTS AlertEvent_userId_createdAt_idx ON AlertEvent(userId, createdAt)',
  'CREATE INDEX IF NOT EXISTS AlertEvent_ruleId_idx ON AlertEvent(ruleId)',
  'CREATE INDEX IF NOT EXISTS AlertEvent_emailedAt_idx ON AlertEvent(emailedAt)',
  'CREATE UNIQUE INDEX IF NOT EXISTS AlertSnapshot_kind_key_key ON AlertSnapshot(kind, key)',
  'CREATE INDEX IF NOT EXISTS AlertSnapshot_kind_idx ON AlertSnapshot(kind)',
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
