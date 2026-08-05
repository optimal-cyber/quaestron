import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { syncFedrampData, type MappedProduct } from './fedramp'

/**
 * "Seen this run" reconciliation.
 *
 * The dangerous failure is not missing a withdrawal — it is inventing one. A
 * partial run has legitimately not looked at the records after its cursor, and
 * marking that tail WITHDRAWN_UPSTREAM would tell users a vendor lost its
 * authorization because our function ran out of time. On a compliance product
 * that is the same error as the one this whole mechanism exists to fix, just
 * inverted, so the truncation cases come first and carry the most cases.
 */

function record(packageId: string): MappedProduct {
  return {
    packageId,
    cspName: `CSP ${packageId}`,
    csoName: `CSO ${packageId}`,
    status: 'Authorized',
    impactLevel: 'Moderate',
    serviceModel: '[]',
    deploymentModel: null,
    authorizationDate: null,
    expirationDate: null,
    sponsoringAgency: null,
    leveragingAgencies: '[]',
    assessorName: null,
    authType: null,
    serviceDescription: null,
    website: null,
    logo: null,
  }
}

const ALL = ['FR-01', 'FR-02', 'FR-03', 'FR-04', 'FR-05'].map(record)

async function states(): Promise<Record<string, string>> {
  const rows = await prisma.fedrampAuthorization.findMany({
    select: { packageId: true, lifecycleState: true },
  })
  return Object.fromEntries(rows.map((r) => [r.packageId, r.lifecycleState]))
}

beforeEach(async () => {
  await prisma.fedrampAuthorization.deleteMany({})
  await prisma.atoSyncLog.deleteMany({})
})

describe('reconciliation — must not invent withdrawals', () => {
  it('marks nothing when the run stopped on its deadline', async () => {
    await syncFedrampData(ALL)

    // A run that dies before touching anything must not conclude that the
    // entire marketplace was withdrawn.
    const r = await syncFedrampData(ALL, { deadline: Date.now() - 60_000 })
    expect(r.completed).toBe(false)
    expect(r.withdrawn).toBe(0)
    expect(Object.values(await states()).every((s) => s === 'ACTIVE')).toBe(true)
  })

  it('marks nothing on a mid-set truncation, including the untouched tail', async () => {
    await syncFedrampData(ALL)

    // Resume partway, then die. FR-04 and FR-05 were never examined; they are
    // unseen because we ran out of budget, not because they left the feed.
    const r = await syncFedrampData(ALL, { cursor: 'FR-02', deadline: Date.now() - 60_000 })
    expect(r.completed).toBe(false)
    expect(r.withdrawn).toBe(0)
    const s = await states()
    expect(s['FR-04']).toBe('ACTIVE')
    expect(s['FR-05']).toBe('ACTIVE')
  })

  it('does not withdraw records the feed still lists but this run skipped', async () => {
    await syncFedrampData(ALL)
    // Resuming after FR-03 processes only FR-04/FR-05, yet FR-01..03 are still
    // in the feed. Reconciliation keys on the full record set, not the slice.
    const r = await syncFedrampData(ALL, { cursor: 'FR-03' })
    expect(r.completed).toBe(true)
    expect(r.withdrawn).toBe(0)
    expect(Object.values(await states()).every((s) => s === 'ACTIVE')).toBe(true)
  })

  it('skips reconciliation entirely when the feed comes back empty', async () => {
    await syncFedrampData(ALL)
    // A degraded fetch yielding zero records is a fetch failure, not the
    // simultaneous withdrawal of every offering in the marketplace.
    const r = await syncFedrampData([])
    expect(r.withdrawn).toBe(0)
    expect(Object.values(await states()).every((s) => s === 'ACTIVE')).toBe(true)
  })
})

describe('reconciliation — marks real withdrawals', () => {
  it('marks a record that left the feed', async () => {
    await syncFedrampData(ALL)
    const r = await syncFedrampData(ALL.filter((x) => x.packageId !== 'FR-03'))
    expect(r.completed).toBe(true)
    expect(r.withdrawn).toBe(1)
    const s = await states()
    expect(s['FR-03']).toBe('WITHDRAWN_UPSTREAM')
    expect(s['FR-01']).toBe('ACTIVE')
  })

  it('keeps the row rather than deleting it', async () => {
    await syncFedrampData(ALL)
    await syncFedrampData(ALL.filter((x) => x.packageId !== 'FR-03'))
    const row = await prisma.fedrampAuthorization.findUnique({ where: { packageId: 'FR-03' } })
    // A withdrawal is a fact users may want to see, not a reason to lose history.
    expect(row).not.toBeNull()
    expect(row?.status).toBe('Authorized')
  })

  it('restores a record that comes back', async () => {
    await syncFedrampData(ALL)
    await syncFedrampData(ALL.filter((x) => x.packageId !== 'FR-03'))
    expect((await states())['FR-03']).toBe('WITHDRAWN_UPSTREAM')

    await syncFedrampData(ALL)
    expect((await states())['FR-03']).toBe('ACTIVE')
  })

  it('does not re-count an already-withdrawn record on the next run', async () => {
    await syncFedrampData(ALL)
    const without = ALL.filter((x) => x.packageId !== 'FR-03')
    expect((await syncFedrampData(without)).withdrawn).toBe(1)
    // Idempotent: the second run finds nothing new to withdraw.
    expect((await syncFedrampData(without)).withdrawn).toBe(0)
  })

  it('never overwrites a human-confirmed SUPERSEDED verdict', async () => {
    await syncFedrampData(ALL)
    await prisma.fedrampAuthorization.update({
      where: { packageId: 'FR-03' },
      data: { lifecycleState: 'SUPERSEDED', supersededByPackageId: 'FR-99' },
    })
    const r = await syncFedrampData(ALL.filter((x) => x.packageId !== 'FR-03'))
    expect(r.withdrawn).toBe(0)
    const row = await prisma.fedrampAuthorization.findUnique({ where: { packageId: 'FR-03' } })
    expect(row?.lifecycleState).toBe('SUPERSEDED')
    expect(row?.supersededByPackageId).toBe('FR-99')
  })

  it('stamps lastSeenUpstreamAt only on a completed run', async () => {
    await syncFedrampData(ALL)
    const after = await prisma.fedrampAuthorization.findUnique({ where: { packageId: 'FR-01' } })
    expect(after?.lastSeenUpstreamAt).not.toBeNull()

    await prisma.fedrampAuthorization.updateMany({ data: { lastSeenUpstreamAt: null } })
    await syncFedrampData(ALL, { deadline: Date.now() - 60_000 })
    const partial = await prisma.fedrampAuthorization.findUnique({ where: { packageId: 'FR-01' } })
    expect(partial?.lastSeenUpstreamAt).toBeNull()
  })
})
