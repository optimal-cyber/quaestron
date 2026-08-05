import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { syncFedrampData, fedrampResumeCursor, type MappedProduct } from './fedramp'

/**
 * Resumable-sync regression suite.
 *
 * The failure this guards against is specific: a sync that cannot finish inside
 * the function's 300s ceiling restarts from the same place every night and
 * never converges. A partial run that resumes is fine; one that replays the
 * same prefix forever is not.
 *
 * Runs against the disposable database from tests/global-setup.ts.
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

// Deliberately unsorted, to prove ordering comes from the sync not the input.
const RECORDS = ['FR-05', 'FR-01', 'FR-04', 'FR-02', 'FR-03'].map(record)

beforeEach(async () => {
  await prisma.fedrampAuthorization.deleteMany({})
  await prisma.atoSyncLog.deleteMany({})
})

describe('syncFedrampData — completion', () => {
  it('processes every record and reports completed with a null cursor', async () => {
    const r = await syncFedrampData(RECORDS)
    expect(r.completed).toBe(true)
    expect(r.cursor).toBeNull()
    expect(r.processed).toBe(5)
    expect(r.added).toBe(5)
    expect(await prisma.fedrampAuthorization.count()).toBe(5)
  })

  it('records success with no cursor, so the next run starts clean', async () => {
    await syncFedrampData(RECORDS)
    const log = await prisma.atoSyncLog.findUnique({ where: { source: 'fedramp' } })
    expect(log?.status).toBe('success')
    expect(log?.cursor).toBeNull()
    expect(await fedrampResumeCursor()).toBeNull()
  })

  it('is idempotent — a second full run updates rather than duplicates', async () => {
    await syncFedrampData(RECORDS)
    const second = await syncFedrampData(RECORDS)
    expect(second.added).toBe(0)
    expect(second.updated).toBe(5)
    expect(await prisma.fedrampAuthorization.count()).toBe(5)
  })
})

describe('syncFedrampData — deadline and resumption', () => {
  it('stops at the deadline and reports a partial run', async () => {
    // Already expired: stops before doing any work.
    const r = await syncFedrampData(RECORDS, { deadline: Date.now() - 1 })
    expect(r.completed).toBe(false)
    expect(r.processed).toBe(0)
    expect(await prisma.fedrampAuthorization.count()).toBe(0)
  })

  it('persists status=partial with the resume point', async () => {
    await syncFedrampData(RECORDS, { deadline: Date.now() - 1 })
    const log = await prisma.atoSyncLog.findUnique({ where: { source: 'fedramp' } })
    expect(log?.status).toBe('partial')
  })

  it('resumes strictly AFTER the cursor, never replaying it', async () => {
    // Simulate a first run that got through FR-01 and FR-02.
    await syncFedrampData(RECORDS.filter((r) => r.packageId <= 'FR-02'))
    const r = await syncFedrampData(RECORDS, { cursor: 'FR-02' })
    expect(r.processed).toBe(3)
    // The three after the cursor were new; the two before were untouched.
    expect(r.added).toBe(3)
    expect(r.updated).toBe(0)
  })

  it('converges: repeated one-record slices finish the whole set', async () => {
    // The property that matters. A run that always restarts from zero would
    // loop forever here; this must terminate having covered every record.
    let cursor: string | null = null
    let guard = 0
    do {
      const r: Awaited<ReturnType<typeof syncFedrampData>> = await syncFedrampData(
        RECORDS,
        { cursor, deadline: Date.now() + 1 }
      )
      cursor = r.cursor
      if (++guard > 20) throw new Error('did not converge — sync is replaying its prefix')
    } while (cursor !== null)

    expect(await prisma.fedrampAuthorization.count()).toBe(5)
    expect(await fedrampResumeCursor()).toBeNull()
  })

  it('advances the cursor in sorted order regardless of input order', async () => {
    const r = await syncFedrampData(RECORDS, { cursor: 'FR-03' })
    // Only FR-04 and FR-05 sort after FR-03.
    expect(r.processed).toBe(2)
    const ids = (await prisma.fedrampAuthorization.findMany({ select: { packageId: true } }))
      .map((x) => x.packageId).sort()
    expect(ids).toEqual(['FR-04', 'FR-05'])
  })

  it('counts records with no packageId as failed instead of throwing', async () => {
    const r = await syncFedrampData([...RECORDS, record('')])
    expect(r.failed).toBe(1)
    expect(r.completed).toBe(true)
  })
})
