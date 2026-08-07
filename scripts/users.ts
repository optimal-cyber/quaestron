import 'dotenv/config'
import { createClient } from '@libsql/client'

/**
 * Who has signed up.
 *
 *   npm run users
 *   npm run users -- --since 7d
 *
 * Built for outreach: the question during a campaign is not "how many users"
 * but "did the person I emailed on Tuesday actually create an account, and did
 * they come back". So this reports identity, provider, and return visits rather
 * than a count.
 *
 * Reads production directly rather than through Prisma, so it works regardless
 * of whether the generated client is current.
 */

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}
const client = createClient({ url, authToken })

const args = process.argv.slice(2)
const sinceArg = args[args.indexOf('--since') + 1]
const sinceMs = (() => {
  if (!sinceArg || !args.includes('--since')) return null
  const m = sinceArg.match(/^(\d+)([dhw])$/)
  if (!m) return null
  const mult = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2]]!
  return Date.now() - Number(m[1]) * mult
})()

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const h = (Date.now() - then) / 3_600_000
  if (h < 1) return `${Math.round(h * 60)}m ago`
  if (h < 48) return `${h.toFixed(0)}h ago`
  return `${Math.floor(h / 24)}d ago`
}

async function main() {
  const users = await client.execute(
    'SELECT id, email, name, tier, role, emailVerified, createdAt FROM User ORDER BY createdAt DESC'
  )
  const rows = users.rows as unknown as Array<{
    id: string; email: string | null; name: string | null
    tier: string; role: string; emailVerified: string | null; createdAt: string
  }>

  const filtered = sinceMs ? rows.filter((r) => Date.parse(r.createdAt) >= sinceMs) : rows

  console.log(`\n${filtered.length} user(s)${sinceArg && args.includes('--since') ? ` in the last ${sinceArg}` : ''}\n`)
  if (filtered.length === 0) {
    console.log(`  ${DIM}No signups yet.${RESET}\n`)
    client.close()
    return
  }

  for (const u of filtered) {
    // Which provider they used. An Account row means OAuth; its absence with a
    // verified email means the magic link.
    const acct = await client.execute({
      sql: 'SELECT provider FROM Account WHERE userId = ?',
      args: [u.id],
    })
    const providers = (acct.rows as unknown as Array<{ provider: string }>).map((a) => a.provider)
    const how = providers.length ? providers.join(', ') : u.emailVerified ? 'magic link' : 'unverified'

    // Sessions are the only signal of a return visit under the database
    // strategy — a signup that never came back looks identical otherwise.
    const sess = await client.execute({
      sql: 'SELECT COUNT(*) n, MAX(expires) latest FROM Session WHERE userId = ?',
      args: [u.id],
    })
    const s = sess.rows[0] as unknown as { n: number; latest: string | null }

    const tierColour = u.tier === 'FREE' ? YELLOW : GREEN
    console.log(`  ${u.email ?? '(no email)'}`)
    console.log(
      `     ${tierColour}${u.tier}${RESET}/${u.role}  via ${how}  ` +
        `signed up ${ago(u.createdAt)}  ${DIM}${u.createdAt}${RESET}`
    )
    console.log(
      `     ${s.n > 0 ? `${GREEN}active session${RESET}` : `${DIM}no active session${RESET}`}` +
        (u.name ? `  ${DIM}${u.name}${RESET}` : '')
    )
  }

  // Composition matters more than the total during a campaign: an all-FREE list
  // means nobody has hit a paywall, which is a product signal, not a sales one.
  const byTier: Record<string, number> = {}
  for (const u of rows) byTier[u.tier] = (byTier[u.tier] ?? 0) + 1
  const admins = rows.filter((u) => u.role === 'ADMIN').length
  console.log(`\n  ${rows.length} total  ${Object.entries(byTier).map(([t, n]) => `${t}:${n}`).join('  ')}  ADMIN:${admins}`)
  if (admins === 0) {
    console.log(`  ${YELLOW}No admin account — /admin is closed. Run: npm run admin:promote <email>${RESET}`)
  }
  console.log('')
  client.close()
}

main().catch((err) => {
  console.error('users failed:', err)
  process.exit(1)
})
