import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { buildTargetIndex } from './evaluators'
import { expiryBucket, limitsFor, parseParams, ENGINE_LIMITS } from './types'
import { runAlertEngine } from './engine'

/**
 * Alert engine regression suite.
 *
 * Runs against the disposable database provisioned in tests/global-setup.ts —
 * never dev.db, never production.
 *
 * The DB-backed cases below encode the three properties the engine's
 * correctness rests on, each of which is easy to break with an innocuous
 * refactor:
 *
 *   1. Re-running is idempotent (the dedupeKey unique constraint).
 *   2. A first-seen key records a baseline SILENTLY — otherwise the first run
 *      after any deploy reports the entire watched universe as "changed".
 *   3. The change set is computed once per run, before any rule evaluates, so
 *      two rules watching the same target both see the change.
 */

let entityId: string
let userId: string

beforeAll(async () => {
  const country = await prisma.country.create({
    data: { name: 'United States', alpha2: 'US', latitude: 0, longitude: 0 },
  })
  const entity = await prisma.entity.create({
    data: {
      name: 'Testcorp',
      slug: 'testcorp',
      type: 'CLOUD_INFRA',
      headquartersCountryId: country.id,
    },
  })
  entityId = entity.id

  const user = await prisma.user.create({
    data: { email: 'engine@test.local', tier: 'PRO' },
  })
  userId = user.id
})

/** Fresh rules, events, and snapshots per test; the entity/user persist. */
beforeEach(async () => {
  await prisma.alertEvent.deleteMany({})
  await prisma.alertRule.deleteMany({})
  await prisma.watchlistItem.deleteMany({})
  await prisma.watchlist.deleteMany({})
  await prisma.alertSnapshot.deleteMany({})
  await prisma.contract.deleteMany({})
  await prisma.fedrampAuthorization.deleteMany({})
})

async function makeRule(ruleType: string, opts?: { withEntity?: boolean; params?: string }) {
  const watchlist = await prisma.watchlist.create({ data: { userId, name: 'W' } })
  if (opts?.withEntity !== false) {
    await prisma.watchlistItem.create({
      data: {
        watchlistId: watchlist.id,
        targetType: 'ENTITY',
        targetId: entityId,
        targetKey: entityId,
        label: 'Testcorp',
      },
    })
  }
  return prisma.alertRule.create({
    data: {
      userId,
      watchlistId: watchlist.id,
      ruleType,
      frequency: 'DAILY',
      channel: 'IN_APP',
      params: opts?.params ?? '{}',
    },
  })
}

describe('engine — NEW_CONTRACT', () => {
  it('fires on a fresh award and names the vendor and value', async () => {
    await makeRule('NEW_CONTRACT')
    await prisma.contract.create({
      data: { entityId, awardId: 'T-1', description: 'Test award', value: 4_200_000 },
    })

    const run = await runAlertEngine({ frequencies: ['DAILY'] })
    expect(run.rulesEvaluated).toBe(1)
    expect(run.eventsCreated).toBe(1)

    const [event] = await prisma.alertEvent.findMany()
    expect(event.title).toContain('Testcorp')
    expect(event.title).toContain('$4.2M')
    expect(event.url).toBe('/vendor/testcorp')
  })

  it('is idempotent — a second run creates nothing and counts the duplicate', async () => {
    await makeRule('NEW_CONTRACT')
    await prisma.contract.create({ data: { entityId, awardId: 'T-2', value: 1_000_000 } })

    await runAlertEngine({ frequencies: ['DAILY'] })
    const second = await runAlertEngine({ frequencies: ['DAILY'] })

    expect(second.eventsCreated).toBe(0)
    expect(second.duplicatesSkipped).toBe(1)
    expect(await prisma.alertEvent.count()).toBe(1)
  })

  it('respects the minValue param', async () => {
    await makeRule('NEW_CONTRACT', { params: JSON.stringify({ minValue: 10_000_000 }) })
    await prisma.contract.create({ data: { entityId, awardId: 'T-3', value: 4_200_000 } })

    const run = await runAlertEngine({ frequencies: ['DAILY'] })
    expect(run.eventsCreated).toBe(0)
  })

  it('excludes SBIR awards, which have their own rule type', async () => {
    await makeRule('NEW_CONTRACT')
    await prisma.contract.create({
      data: { entityId, awardId: 'T-4', value: 500_000, sbirProgram: 'SBIR', sbirPhase: 'II' },
    })

    const run = await runAlertEngine({ frequencies: ['DAILY'] })
    expect(run.eventsCreated).toBe(0)
  })

  it('ignores awards older than the lookback window', async () => {
    await makeRule('NEW_CONTRACT')
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const contract = await prisma.contract.create({
      data: { entityId, awardId: 'T-5', value: 900_000 },
    })
    await prisma.contract.update({ where: { id: contract.id }, data: { createdAt: old } })

    const run = await runAlertEngine({ frequencies: ['DAILY'] })
    expect(run.eventsCreated).toBe(0)
  })
})

describe('engine — FEDRAMP_STATUS_CHANGE baseline semantics', () => {
  async function seedFedramp(status: string) {
    return prisma.fedrampAuthorization.create({
      data: {
        packageId: 'FR-TEST-1',
        csoName: 'Test Cloud',
        cspName: 'Testcorp',
        status,
        impactLevel: 'High',
        entityId,
        updatedAt: new Date(),
      },
    })
  }

  it('records a baseline SILENTLY on first sight', async () => {
    await makeRule('FEDRAMP_STATUS_CHANGE')
    await seedFedramp('Authorized')

    const run = await runAlertEngine({ frequencies: ['DAILY'] })

    // The critical assertion: no event, but a baseline now exists.
    expect(run.fedrampChanges).toBe(0)
    expect(run.eventsCreated).toBe(0)
    expect(
      await prisma.alertSnapshot.count({ where: { kind: 'fedramp:status', key: 'FR-TEST-1' } })
    ).toBe(1)
  })

  it('detects a status transition once a baseline exists', async () => {
    await makeRule('FEDRAMP_STATUS_CHANGE')
    await seedFedramp('Authorized')
    await runAlertEngine({ frequencies: ['DAILY'] })

    await prisma.fedrampAuthorization.update({
      where: { packageId: 'FR-TEST-1' },
      data: { status: 'InProcess' },
    })
    const run = await runAlertEngine({ frequencies: ['DAILY'] })

    expect(run.fedrampChanges).toBe(1)
    const [event] = await prisma.alertEvent.findMany({
      where: { ruleType: 'FEDRAMP_STATUS_CHANGE' },
    })
    expect(event.body).toContain('Authorized')
    expect(event.body).toContain('InProcess')
  })

  it('shows the same change to every rule watching it, not just the first', async () => {
    // The regression this guards: computing the diff per-rule lets the first
    // rule advance the baseline and blinds every later rule.
    await makeRule('FEDRAMP_STATUS_CHANGE')
    const otherUser = await prisma.user.create({
      data: { email: `second-${Date.now()}@test.local`, tier: 'PRO' },
    })
    const wl = await prisma.watchlist.create({ data: { userId: otherUser.id, name: 'W2' } })
    await prisma.watchlistItem.create({
      data: {
        watchlistId: wl.id,
        targetType: 'ENTITY',
        targetId: entityId,
        targetKey: entityId,
      },
    })
    await prisma.alertRule.create({
      data: {
        userId: otherUser.id,
        watchlistId: wl.id,
        ruleType: 'FEDRAMP_STATUS_CHANGE',
        frequency: 'DAILY',
        channel: 'IN_APP',
      },
    })

    await seedFedramp('Authorized')
    await runAlertEngine({ frequencies: ['DAILY'] })
    await prisma.fedrampAuthorization.update({
      where: { packageId: 'FR-TEST-1' },
      data: { status: 'InProcess' },
    })
    await runAlertEngine({ frequencies: ['DAILY'] })

    const events = await prisma.alertEvent.findMany({
      where: { ruleType: 'FEDRAMP_STATUS_CHANGE' },
    })
    expect(events.length).toBe(2)
    expect(new Set(events.map((e) => e.userId)).size).toBe(2)

    await prisma.user.delete({ where: { id: otherUser.id } })
  })
})

describe('engine — scheduling and scoping', () => {
  it('skips rules whose watchlist is empty rather than scanning', async () => {
    await makeRule('NEW_CONTRACT', { withEntity: false })
    const run = await runAlertEngine({ frequencies: ['DAILY'] })
    expect(run.rulesSkipped).toBeGreaterThanOrEqual(1)
    expect(run.rulesEvaluated).toBe(0)
  })

  it('does not evaluate inactive rules', async () => {
    const rule = await makeRule('NEW_CONTRACT')
    await prisma.alertRule.update({ where: { id: rule.id }, data: { active: false } })
    await prisma.contract.create({ data: { entityId, awardId: 'T-6', value: 1_000 } })

    const run = await runAlertEngine({ frequencies: ['DAILY'] })
    expect(run.rulesEvaluated).toBe(0)
    expect(run.eventsCreated).toBe(0)
  })

  it('does not evaluate a DAILY rule during a WEEKLY run', async () => {
    await makeRule('NEW_CONTRACT')
    await prisma.contract.create({ data: { entityId, awardId: 'T-7', value: 1_000 } })

    const run = await runAlertEngine({ frequencies: ['WEEKLY'] })
    expect(run.rulesEvaluated).toBe(0)
  })

  it('stamps lastRunAt on rules it evaluated', async () => {
    const rule = await makeRule('NEW_CONTRACT')
    await runAlertEngine({ frequencies: ['DAILY'] })
    const after = await prisma.alertRule.findUnique({ where: { id: rule.id } })
    expect(after?.lastRunAt).not.toBeNull()
  })
})

// ─── Pure helpers ──────────────────────────────────────────────────

describe('buildTargetIndex', () => {
  const entities = new Map([['e1', { id: 'e1', name: 'Palantir', slug: 'palantir' }]])

  it('routes each target type into its own bucket', () => {
    const index = buildTargetIndex(
      [
        { targetType: 'ENTITY', targetId: 'e1', targetValue: null, targetKey: 'e1', label: null },
        { targetType: 'FEDRAMP_CSO', targetId: null, targetValue: 'FR123', targetKey: 'FR123', label: null },
        { targetType: 'AGENCY', targetId: null, targetValue: 'Air Force', targetKey: 'air force', label: null },
        { targetType: 'KEYWORD', targetId: null, targetValue: 'Counter-UAS', targetKey: 'counter-uas', label: null },
        { targetType: 'NAICS', targetId: null, targetValue: '541512', targetKey: '541512', label: null },
      ],
      entities
    )

    expect(index.entityIds.has('e1')).toBe(true)
    expect(index.packageIds.has('FR123')).toBe(true)
    expect(index.naics.has('541512')).toBe(true)
    // Free-text targets are lowercased for case-insensitive matching.
    expect(index.agencies).toContain('air force')
    expect(index.keywords).toContain('counter-uas')
  })

  it('drops ENTITY targets with no id rather than matching everything', () => {
    const index = buildTargetIndex(
      [{ targetType: 'ENTITY', targetId: null, targetValue: null, targetKey: 'x', label: null }],
      entities
    )
    expect(index.entityIds.size).toBe(0)
  })

  it('caps targets so one watchlist cannot make a run unbounded', () => {
    const many = Array.from({ length: ENGINE_LIMITS.maxTargetsPerRule + 50 }, (_, i) => ({
      targetType: 'KEYWORD' as const,
      targetId: null,
      targetValue: `kw${i}`,
      targetKey: `kw${i}`,
      label: null,
    }))
    expect(buildTargetIndex(many, entities).keywords.length).toBe(ENGINE_LIMITS.maxTargetsPerRule)
  })
})

describe('expiryBucket', () => {
  it('returns the tightest bucket a value falls into', () => {
    expect(expiryBucket(5)).toBe(7)
    expect(expiryBucket(7)).toBe(7)
    expect(expiryBucket(10)).toBe(14)
    expect(expiryBucket(45)).toBe(60)
    expect(expiryBucket(90)).toBe(90)
  })

  it('returns null beyond the widest bucket, so distant dates do not alert', () => {
    expect(expiryBucket(91)).toBeNull()
    expect(expiryBucket(365)).toBeNull()
  })

  it('buckets are stable, so an alert fires once per threshold crossed', () => {
    // 30 and 25 days share a bucket; 25 and 12 do not.
    expect(expiryBucket(30)).toBe(expiryBucket(25))
    expect(expiryBucket(25)).not.toBe(expiryBucket(12))
  })
})

describe('parseParams', () => {
  it('parses valid params', () => {
    expect(parseParams(JSON.stringify({ minValue: 1000 }))).toEqual({ minValue: 1000 })
  })

  it.each(['not json', '', '{"minValue":"lots"}', '{"unknown":true}', 'null'])(
    'falls back to empty params for %j rather than throwing',
    (raw) => {
      expect(parseParams(raw)).toEqual({})
    }
  )
})

describe('tier limits', () => {
  it('caps the free tier at 1 watchlist, 5 items, weekly only', () => {
    const free = limitsFor('FREE')
    expect(free.maxWatchlists).toBe(1)
    expect(free.maxItemsPerWatchlist).toBe(5)
    expect(free.frequencies).toEqual(['WEEKLY'])
  })

  it('gives PRO and TEAM unlimited lists and every cadence', () => {
    for (const tier of ['PRO', 'TEAM'] as const) {
      expect(limitsFor(tier).maxWatchlists).toBe(Number.POSITIVE_INFINITY)
      expect(limitsFor(tier).frequencies).toContain('DAILY')
      expect(limitsFor(tier).frequencies).toContain('REALTIME')
    }
  })
})
