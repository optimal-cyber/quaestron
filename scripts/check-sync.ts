import 'dotenv/config'
import { createClient } from '@libsql/client'

/**
 * On-demand sync health check.
 *
 *   npm run check:sync
 *
 * Answers the question "did the nightly run actually work" without needing a
 * scheduled job or an open session. Reads production directly rather than going
 * through Prisma, so it works even when the app's generated client is stale.
 *
 * Exits 0 when the last FedRAMP run succeeded or is legitimately mid-resume,
 * 1 when it failed or has not run since the schedule change, so it can be
 * dropped into CI or a shell pipeline later.
 */

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

/**
 * How old a daily source may be before it counts as failing.
 *
 * Status alone is not enough: `fedramp` has read `success` since 2026-04-10
 * while going four months without a run. A stale success is the failure mode
 * this check exists to catch, so age is graded, not just reported.
 */
const STALE_AFTER_HOURS: Record<string, number> = {
  fedramp: 36,
  'disa-xlsx': 36,
  // Not a cron -- triggered manually. Reported, never graded.
  'vendor-universe': Infinity,
}

function ageHours(iso: string | null): number {
  if (!iso) return Infinity
  const then = Date.parse(iso)
  return Number.isNaN(then) ? Infinity : (Date.now() - then) / 3_600_000
}

function ageString(iso: string | null): string {
  if (!iso) return 'never'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const hours = (Date.now() - then) / 3_600_000
  if (hours < 1) return `${Math.round(hours * 60)}m ago`
  if (hours < 48) return `${hours.toFixed(1)}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

async function main() {
  console.log(`\n${DIM}${url}${RESET}\n`)
  let failed = false

  // ── Sync log ───────────────────────────────────────────────────────────
  const logs = await client.execute(
    'SELECT source, status, lastSyncAt, recordsAdded, recordsUpdated, recordsFailed, cursor FROM AtoSyncLog ORDER BY source'
  )

  console.log('SYNC LOG')
  for (const row of logs.rows) {
    const r = row as unknown as {
      source: string
      status: string
      lastSyncAt: string | null
      recordsAdded: number
      recordsUpdated: number
      recordsFailed: number
      cursor: string | null
    }
    const statusOk = r.status === 'success'
    // A partial run with a cursor is the resume mechanism working, not a fault.
    const resuming = r.status === 'partial' && !!r.cursor
    const limit = STALE_AFTER_HOURS[r.source] ?? Infinity
    const stale = ageHours(r.lastSyncAt) > limit

    const ok = (statusOk || resuming) && !stale
    const colour = ok ? (resuming ? YELLOW : GREEN) : RED
    const mark = ok ? (resuming ? '~' : '✓') : '✗'
    if (!ok) failed = true

    console.log(
      `  ${colour}${mark} ${r.source.padEnd(16)}${RESET} ` +
        `${String(r.status).padEnd(9)} ${ageString(r.lastSyncAt).padStart(9)}  ` +
        `+${r.recordsAdded} ~${r.recordsUpdated} !${r.recordsFailed}` +
        (r.cursor ? `  ${DIM}resume after ${r.cursor}${RESET}` : '')
    )
    if (r.lastSyncAt) console.log(`    ${DIM}${r.lastSyncAt}${RESET}`)
    if (stale) {
      console.log(
        `    ${RED}STALE — status says "${r.status}" but the last run was ` +
          `${ageString(r.lastSyncAt)}, past the ${limit}h daily budget.${RESET}`
      )
    }
  }

  if (!logs.rows.some((r) => (r as unknown as { source: string }).source === 'fedramp')) {
    console.log(`  ${RED}✗ no fedramp row at all${RESET}`)
    failed = true
  }

  // ── Column population ──────────────────────────────────────────────────
  const counts = await client.execute(`
    SELECT
      COUNT(*)                                                  AS total,
      SUM(CASE WHEN uei IS NOT NULL AND uei != '' THEN 1 ELSE 0 END)   AS withUei,
      SUM(CASE WHEN smallBusiness IS NOT NULL THEN 1 ELSE 0 END)       AS withSmallBiz,
      SUM(CASE WHEN entityId IS NOT NULL THEN 1 ELSE 0 END)            AS withEntity,
      SUM(CASE WHEN expirationDate IS NOT NULL THEN 1 ELSE 0 END)      AS withExpiry
    FROM FedrampAuthorization
  `)
  const c = counts.rows[0] as unknown as Record<string, number>
  const pct = (n: number) => `${((n / Math.max(1, c.total)) * 100).toFixed(0)}%`

  console.log('\nFEDRAMP COLUMNS')
  console.log(`  rows              ${c.total}`)
  for (const [label, value] of [
    ['uei', c.withUei],
    ['smallBusiness', c.withSmallBiz],
    ['entityId (linked)', c.withEntity],
    ['expirationDate', c.withExpiry],
  ] as const) {
    const colour = value === 0 ? RED : value < c.total / 2 ? YELLOW : GREEN
    console.log(`  ${String(label).padEnd(17)} ${colour}${value} (${pct(value)})${RESET}`)
  }
  if (c.withUei === 0 || c.withSmallBiz === 0) {
    console.log(`  ${YELLOW}→ still zero means the run did not reach the write path${RESET}`)
  }

  // ── Status mix ─────────────────────────────────────────────────────────
  const statuses = await client.execute(
    'SELECT status, COUNT(*) AS n FROM FedrampAuthorization GROUP BY status ORDER BY n DESC'
  )
  console.log('\nSTATUS MIX')
  for (const row of statuses.rows) {
    const r = row as unknown as { status: string; n: number }
    console.log(`  ${String(r.status).padEnd(17)} ${r.n}`)
  }
  console.log(
    `  ${DIM}Authorized is the only one that means "cleared to operate";${RESET}\n` +
      `  ${DIM}the others are pipeline and must not be counted as authorizations.${RESET}`
  )

  console.log(
    failed
      ? `\n${RED}FAIL — the last run did not succeed.${RESET}\n`
      : `\n${GREEN}OK${RESET}\n`
  )
  client.close()
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error('check failed:', err)
  process.exit(1)
})
