import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { syncVendor } from '@/lib/vendor/sync-vendor'
import { resolveEntity } from '@/lib/match/aliases'
import { RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Batch pre-enrichment, for warming a prospect's portfolio before a demo.
 *
 *   npm run pre-enrich -- --names "Anduril, Shield AI, Saronic"
 *   npm run pre-enrich -- --file portfolio.txt
 *   npm run pre-enrich -- --file portfolio.txt --delay 5000
 *   npm run pre-enrich -- --file portfolio.txt --dry-run
 *
 * Reports three outcomes per name, which are NOT the same thing:
 *
 *   matched   resolved to an entity we already tracked
 *   created   no entity existed; one was created and enriched
 *   failed    enrichment errored — the name is left as-is
 *
 * The distinction matters for a demo. A "created" row means we had never heard
 * of that company before you typed it, which is worth knowing before someone
 * searches their own holding in front of you.
 */

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (name: string) => args.includes(`--${name}`)

/**
 * Target seconds between the START of one enrichment and the next, derived from
 * the existing vendorSync budget (5 per 300s = one per 60s). A batch therefore
 * costs the external APIs no more than the public endpoint already allows.
 *
 * This is an INTERVAL, not an added delay. Enrichment itself takes 5-75s
 * depending on how many awards a company has, so sleeping a further 60s on top
 * would halve throughput while making no difference to the rate those APIs
 * actually see. We sleep only the remainder.
 */
const TARGET_INTERVAL_MS = Math.ceil(
  (RATE_LIMITS.vendorSync.windowSeconds * 1000) / RATE_LIMITS.vendorSync.limit
)

const intervalMs = flag('delay') ? Number(flag('delay')) : TARGET_INTERVAL_MS
const dryRun = has('dry-run')
const force = has('force')

function names(): string[] {
  const file = flag('file')
  const inline = flag('names')
  const raw = file ? readFileSync(file, 'utf8') : inline ?? ''
  return [...new Set(
    raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !s.startsWith('#'))
  )]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

async function main() {
  const list = names()
  if (list.length === 0) {
    console.error('Usage: --names "A, B, C"  |  --file portfolio.txt   [--delay ms] [--force] [--dry-run]')
    process.exit(1)
  }

  console.log(`\n${list.length} name(s), one every ${Math.round(intervalMs / 1000)}s`)
  console.log(`projected: ~${fmtDuration(list.length * intervalMs)} (companies with many awards take longer than the interval and set their own pace)\n`)

  if (dryRun) {
    console.log('DRY RUN — resolution only, no enrichment, no writes\n')
    let known = 0
    for (const name of list) {
      const hit = await resolveEntity({ name })
      if (hit) known++
      console.log(`  ${hit ? '●' : '○'} ${name}${hit ? `  ->  ${hit.name} (/${hit.slug})` : '  -> not tracked'}`)
    }
    console.log(`\n${known}/${list.length} already tracked; ${list.length - known} would be created.`)
    return
  }

  const started = Date.now()
  const matched: string[] = []
  const created: string[] = []
  const failed: Array<{ name: string; error: string }> = []
  let totalContracts = 0
  let totalSbir = 0

  for (const [i, name] of list.entries()) {
    const t0 = Date.now()
    // Resolved BEFORE enrichment, because syncVendor creates on miss — asking
    // afterwards would report every name as tracked and hide the real answer.
    const pre = await resolveEntity({ name })

    try {
      const r = await syncVendor({ name, force })
      totalContracts += r.counts.federalContracts
      totalSbir += r.counts.sbirAwards
      const label = pre ? 'matched' : 'created'
      ;(pre ? matched : created).push(name)
      const flags = r.riskFlags.length ? ` flags=${r.riskFlags.join(',')}` : ''
      const skipped = r.skipped ? ' (fresh, skipped)' : ''
      console.log(
        `  [${i + 1}/${list.length}] ${label.padEnd(7)} ${name} -> ${r.entity.name} ` +
          `(/${r.entity.slug})  contracts=${r.counts.federalContracts} sbir=${r.counts.sbirAwards}` +
          `${flags}${skipped}  ${fmtDuration(Date.now() - t0)}`
      )
      if (r.errors.length) for (const e of r.errors) console.log(`        ! ${e}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ name, error: msg })
      console.log(`  [${i + 1}/${list.length}] FAILED  ${name}: ${msg}`)
    }

    // Sleep only the remainder of the interval; a 74s enrichment has already
    // paid its own way and gets no extra wait.
    if (i < list.length - 1) {
      const remaining = intervalMs - (Date.now() - t0)
      if (remaining > 0) await sleep(remaining)
    }
  }

  const elapsed = Date.now() - started
  console.log(`\n${'-'.repeat(64)}`)
  console.log(`elapsed:        ${fmtDuration(elapsed)}  (${Math.round(elapsed / list.length / 1000)}s per company)`)
  console.log(`matched:        ${matched.length}`)
  console.log(`created:        ${created.length}${created.length ? `  ${created.slice(0, 8).join(', ')}${created.length > 8 ? ', ...' : ''}` : ''}`)
  console.log(`failed:         ${failed.length}`)
  for (const f of failed) console.log(`   ✗ ${f.name}: ${f.error}`)
  console.log(`contracts:      ${totalContracts}`)
  console.log(`sbir awards:    ${totalSbir}`)

  if (failed.length) {
    console.log(`\nRe-run just the failures:`)
    console.log(`  npm run pre-enrich -- --names "${failed.map((f) => f.name).join(', ')}"`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('pre-enrich failed:', err)
    process.exit(1)
  })
