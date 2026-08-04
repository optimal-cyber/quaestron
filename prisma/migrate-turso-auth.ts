import 'dotenv/config'
import { createClient } from '@libsql/client'

/**
 * Phase 1 — Auth.js (NextAuth v5) tables + the LibSQL-backed rate-limit table.
 *
 * Purely additive: every statement is IF NOT EXISTS, so it is safe to re-run
 * and it never touches existing intel tables. Run once against production
 * Turso after deploying the Phase 1 schema:
 *
 *   npx tsx prisma/migrate-turso-auth.ts
 */

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

const tables = [
  `CREATE TABLE IF NOT EXISTS User (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    emailVerified DATETIME,
    image TEXT,
    tier TEXT NOT NULL DEFAULT 'FREE',
    role TEXT NOT NULL DEFAULT 'USER',
    stripeCustomerId TEXT,
    alertEmailOptIn BOOLEAN NOT NULL DEFAULT true,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS Account (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    providerAccountId TEXT NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at INTEGER,
    token_type TEXT,
    scope TEXT,
    id_token TEXT,
    session_state TEXT,
    refresh_token_expires_in INTEGER,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS Session (
    id TEXT PRIMARY KEY,
    sessionToken TEXT NOT NULL,
    userId TEXT NOT NULL,
    expires DATETIME NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS VerificationToken (
    identifier TEXT NOT NULL,
    token TEXT NOT NULL,
    expires DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS RateLimit (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    expiresAt DATETIME NOT NULL
  )`,
]

const indexes = [
  'CREATE UNIQUE INDEX IF NOT EXISTS User_email_key ON User(email)',
  'CREATE UNIQUE INDEX IF NOT EXISTS User_stripeCustomerId_key ON User(stripeCustomerId)',
  'CREATE UNIQUE INDEX IF NOT EXISTS Account_provider_providerAccountId_key ON Account(provider, providerAccountId)',
  'CREATE INDEX IF NOT EXISTS Account_userId_idx ON Account(userId)',
  'CREATE UNIQUE INDEX IF NOT EXISTS Session_sessionToken_key ON Session(sessionToken)',
  'CREATE INDEX IF NOT EXISTS Session_userId_idx ON Session(userId)',
  'CREATE UNIQUE INDEX IF NOT EXISTS VerificationToken_token_key ON VerificationToken(token)',
  'CREATE UNIQUE INDEX IF NOT EXISTS VerificationToken_identifier_token_key ON VerificationToken(identifier, token)',
  'CREATE INDEX IF NOT EXISTS RateLimit_expiresAt_idx ON RateLimit(expiresAt)',
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
