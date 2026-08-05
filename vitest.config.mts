import { defineConfig } from 'vitest/config'

/**
 * Test setup notes:
 *
 * - `globalSetup` provisions a throwaway SQLite database and points
 *   TURSO_DATABASE_URL at it BEFORE any test imports `lib/db`. That env var is
 *   what `lib/db.ts` reads (it falls back to `file:dev.db`), so setting it is
 *   the only way to keep the suite off the real development database.
 * - `fileParallelism: false`: the DB-backed tests share one SQLite file, and
 *   parallel workers would race on the alert-snapshot baselines they assert on.
 * - `.mts` so the ESM config loads natively without a CJS interop warning.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
