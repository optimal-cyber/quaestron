import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

/**
 * Provisions a disposable SQLite database for the DB-backed tests.
 *
 * `lib/db.ts` resolves its connection from TURSO_DATABASE_URL, falling back to
 * `file:dev.db`. Setting that variable here — before any test file imports the
 * Prisma client — is what guarantees the suite never touches the real
 * development database, and never the production one.
 */
const TEST_DIR = path.resolve(process.cwd(), '.test-db')
const TEST_DB = path.join(TEST_DIR, 'test.db')

export default function setup() {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })

  // `--url` is explicit so a stray TURSO_DATABASE_URL in the developer's shell
  // can't retarget the schema push at a real database.
  execFileSync('npx', ['prisma', 'db', 'push', '--url', `file:${TEST_DB}`], {
    stdio: 'pipe',
    env: { ...process.env, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '' },
  })

  process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`
  process.env.TURSO_AUTH_TOKEN = ''

  return () => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}
