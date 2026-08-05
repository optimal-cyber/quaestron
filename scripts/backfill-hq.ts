import 'dotenv/config'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * Backfill entity headquarters from Surveillance Watch's factual HQ data.
 *
 *   npm run backfill:hq                  # dry run, writes nothing
 *   npm run backfill:hq -- --apply
 *   npm run backfill:hq -- --revert <snapshot>
 *
 * The globe aggregates markers per country, so with only 170 of 2,472 entities
 * carrying a country — 167 of them the US — it renders four dots. This is the
 * data fix behind that, not a rendering one.
 *
 * EVIDENCE ONLY, NEVER A DEFAULT. app/api/admin/backfill-countries does
 * `KNOWN_HQ[entity.name] || 'US'`, which assigns the United States to every
 * entity it cannot identify — including Serbian, Israeli and French vendors.
 * That is the assert-a-false-fact class of error, and on a globe it is visible
 * to anyone who looks at it. This script updates a row only when the source
 * states a country, and leaves the rest null so they read as unknown.
 *
 * ON PROVENANCE: this reads only the FACT of where a company is headquartered,
 * plus the country name. It does not copy Surveillance Watch's prose. Facts are
 * not copyrightable; their editorial writing is, which is why the descriptions
 * are being removed separately rather than reused.
 */

const SW_URL = 'https://www.surveillancewatch.io/api/v1/entities'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}
const client = createClient({ url, authToken })

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const revert = args.includes('--revert')

/** Match key that survives punctuation and casing differences between sources. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

interface SwRecord {
  name: string
  slug: string
  country: string
  city: string | null
}

async function fetchSurveillanceWatch(): Promise<SwRecord[]> {
  const res = await fetch(SW_URL, { signal: AbortSignal.timeout(180_000) })
  if (!res.ok) throw new Error(`Surveillance Watch fetch failed: ${res.status}`)
  const json = await res.json()
  const items = json?.items
  if (!Array.isArray(items) || items.length === 0) {
    // An empty payload is a fetch failure, not the sudden disappearance of
    // every company. Refusing here keeps a bad response from doing nothing
    // quietly and being mistaken for "already up to date".
    throw new Error('Surveillance Watch returned no items — refusing to proceed')
  }

  const out: SwRecord[] = []
  for (const item of items) {
    const hq = item?.headquarters
    if (!hq || typeof hq !== 'object' || !hq.name) continue
    const rawCity = item?.headquartersCity
    const city =
      typeof rawCity === 'string'
        ? rawCity
        : rawCity && typeof rawCity === 'object' && typeof rawCity.name === 'string'
          ? rawCity.name
          : null
    out.push({ name: String(item.name ?? ''), slug: String(item.slug ?? ''), country: String(hq.name), city })
  }
  return out
}

async function doRevert() {
  const path = args[args.indexOf('--revert') + 1]
  if (!path || !existsSync(path)) {
    console.error('Usage: --revert <path to .backfill/hq-*.json>')
    process.exit(1)
  }
  const snap = JSON.parse(readFileSync(path, 'utf8'))
  for (const r of snap.rows) {
    await client.execute({
      sql: 'UPDATE Entity SET headquartersCountryId = ?, headquartersCity = ? WHERE id = ?',
      args: [r.headquartersCountryId, r.headquartersCity, r.id],
    })
  }
  console.log(`Reverted ${snap.rows.length} entities to their prior HQ values.`)
}

async function main() {
  if (revert) {
    await doRevert()
    client.close()
    return
  }

  const sw = await fetchSurveillanceWatch()
  console.log(`\nSurveillance Watch: ${sw.length} records carrying a headquarters country`)

  const [entRes, coRes] = await Promise.all([
    client.execute('SELECT id, name, slug, headquartersCountryId, headquartersCity FROM Entity'),
    client.execute('SELECT id, name, alpha2 FROM Country'),
  ])
  const entities = entRes.rows as unknown as Array<{
    id: string; name: string; slug: string
    headquartersCountryId: string | null; headquartersCity: string | null
  }>
  const countryByName = new Map(
    (coRes.rows as unknown as Array<{ id: string; name: string; alpha2: string }>).map((c) => [
      norm(c.name), c,
    ])
  )
  const bySlug = new Map(entities.map((e) => [e.slug, e]))
  const byName = new Map(entities.map((e) => [norm(e.name), e]))

  const plan: Array<{ entity: (typeof entities)[number]; countryId: string; alpha2: string; country: string; city: string | null }> = []
  const unmatchedEntity: string[] = []
  const unmatchedCountry = new Set<string>()
  let alreadySet = 0

  for (const rec of sw) {
    const entity = bySlug.get(rec.slug) ?? byName.get(norm(rec.name))
    if (!entity) { unmatchedEntity.push(rec.name); continue }

    const country = countryByName.get(norm(rec.country))
    if (!country) { unmatchedCountry.add(rec.country); continue }

    // Never overwrite an existing value; this is a backfill, not a re-sync.
    if (entity.headquartersCountryId) { alreadySet++; continue }

    plan.push({
      entity,
      countryId: country.id,
      alpha2: country.alpha2,
      country: rec.country,
      city: entity.headquartersCity ? null : rec.city,
    })
  }

  const byCountry = new Map<string, number>()
  for (const p of plan) byCountry.set(p.alpha2, (byCountry.get(p.alpha2) ?? 0) + 1)

  console.log(`  matched to entities:       ${plan.length + alreadySet}`)
  console.log(`  already had a country:     ${alreadySet}`)
  console.log(`  WOULD GAIN a country:      ${plan.length}`)
  console.log(`  cities also filled:        ${plan.filter((p) => p.city).length}`)
  if (unmatchedEntity.length) console.log(`  SW records with no entity: ${unmatchedEntity.length}`)
  if (unmatchedCountry.size) console.log(`  countries with no row:     ${[...unmatchedCountry].join(', ')}`)

  const before = entities.filter((e) => e.headquartersCountryId).length
  console.log(`\n  entities with a country:   ${before} -> ${before + plan.length} (of ${entities.length})`)
  console.log(`  distinct countries on globe: ${new Set(entities.filter(e=>e.headquartersCountryId).map(e=>e.headquartersCountryId)).size} -> up to ${new Set([...entities.filter(e=>e.headquartersCountryId).map(e=>e.headquartersCountryId), ...plan.map(p=>p.countryId)]).size}`)
  console.log(`\n  top additions: ${[...byCountry.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>`${k}:${v}`).join('  ')}`)

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.\n`)
    client.close()
    return
  }

  // Snapshot BEFORE any write, directory created first.
  mkdirSync('.backfill', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = `.backfill/hq-${stamp}.json`
  writeFileSync(
    path,
    JSON.stringify(
      { takenAt: stamp, source: SW_URL, rows: plan.map((p) => ({
        id: p.entity.id,
        headquartersCountryId: p.entity.headquartersCountryId,
        headquartersCity: p.entity.headquartersCity,
      })) },
      null,
      2
    )
  )
  console.log(`\nSnapshot: ${path}`)

  let n = 0
  for (const p of plan) {
    await client.execute({
      sql: p.city
        ? 'UPDATE Entity SET headquartersCountryId = ?, headquartersCity = ? WHERE id = ?'
        : 'UPDATE Entity SET headquartersCountryId = ? WHERE id = ?',
      args: p.city ? [p.countryId, p.city, p.entity.id] : [p.countryId, p.entity.id],
    })
    if (++n % 100 === 0) console.log(`  ${n}/${plan.length}`)
  }

  console.log(`Applied ${n} update(s).`)
  console.log(`Revert:  npm run backfill:hq -- --revert ${path}`)
  client.close()
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
