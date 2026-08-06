import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/db'
import {
  dcasUrlForDate,
  parseDcasWorkbook,
  syncDisaData,
  lastKnownDcasDate,
  rememberDcasDate,
  DISA_SYNC_SOURCE,
} from './disa'

// rememberDcasDate is called directly rather than re-implemented here. A helper
// that repeats the upsert would pass even if production wrote the wrong key,
// which is the same empty-assertion shape that let a 404ing DCAS URL ship.

/**
 * DCAS ingest.
 *
 * The URL test is the important one. This module spent months building
 * `DCAS+Current+Authorized+CSOs+-+<date>.xlsx`, which 404s for every date, so
 * the probe walk could not have succeeded no matter how long it ran. Nothing
 * caught it because nothing asserted the URL — the timeouts and budgets added
 * around it all described a loop that was already dead. A literal expected
 * string is deliberate: anything that reconstructs the URL from the same
 * constants would have passed while the code was broken.
 */

describe('dcasUrlForDate', () => {
  it('builds the exact URL shape DISA serves', () => {
    // Verified against the live server: this URL returns 200 with a 19852-byte
    // workbook. Underscores between words, hyphen before the date, no plus signs.
    expect(dcasUrlForDate(new Date('2026-07-08T00:00:00Z'))).toBe(
      'https://dl.dod.cyber.mil/wp-content/uploads/cloud/xls/DCAS-Current_Authorized_CSOs-2026-07-08.xlsx'
    )
  })

  it('zero-pads month and day', () => {
    expect(dcasUrlForDate(new Date('2026-01-05T00:00:00Z'))).toContain('-2026-01-05.xlsx')
  })

  it('uses UTC, so a late-evening local run does not skip a day', () => {
    // 23:30 US Eastern on the 8th is already the 9th in UTC. Reading local
    // components here would probe the wrong date for part of every day.
    expect(dcasUrlForDate(new Date('2026-07-09T03:30:00Z'))).toContain('-2026-07-09.xlsx')
  })
})

/** Mirrors the real workbook: header row, then one row per authorization. */
function workbook(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Cloud Service Provider', 'CSO Title', 'Data Impact Level', 'Service Models', 'DOD Auth Status', 'Auth Expiration'],
    ...rows,
  ])
  XLSX.utils.book_append_sheet(wb, sheet, 'DCAS Current Authorized CSOs')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

describe('parseDcasWorkbook', () => {
  it('skips the header and maps the columns', () => {
    const recs = parseDcasWorkbook(
      workbook([['Amazon', 'AWS Isolated Secret Region', 'IL6', 'IaaS; PaaS', 'Provisional Authorization', '4/29/2029']])
    )
    expect(recs).toHaveLength(1)
    expect(recs[0].cspName).toBe('Amazon')
    expect(recs[0].csoName).toBe('AWS Isolated Secret Region')
    expect(recs[0].impactLevel).toBe('IL6')
    expect(recs[0].paExpiration?.getFullYear()).toBe(2029)
    expect(recs[0].sponsorComponent).toBe('DISA')
  })

  it('strips the qualifier from impact levels', () => {
    // The live file writes "IL4 moderate" and "IL4 high" — the same impact
    // level with a baseline attached. Left raw, IL4 would split into three
    // distinct values and every IL-based filter would undercount.
    const recs = parseDcasWorkbook(
      workbook([
        ['A', 'One', 'IL4 moderate', '', '', ''],
        ['B', 'Two', 'IL4 high', '', '', ''],
        ['C', 'Three', 'IL2 moderate', '', '', ''],
      ])
    )
    expect(recs.map((r) => r.impactLevel)).toEqual(['IL4', 'IL4', 'IL2'])
  })

  it('treats a non-date expiration as no expiration', () => {
    // The FedRAMP reciprocity row carries "Ongoing". Coercing that through
    // `new Date()` is how a column fills with nonsense dates that look real.
    const recs = parseDcasWorkbook(workbook([['FedRAMP Marketplace CSP-CSO', 'Reciprocity', 'IL2 moderate', '', '', 'Ongoing']]))
    expect(recs[0].paExpiration).toBeNull()
  })

  it('keeps service models and status in conditions', () => {
    const recs = parseDcasWorkbook(
      workbook([['Armis', 'Armis Government Cloud', 'IL4 moderate', 'Software as a Service (SaaS)', 'Provisional Authorization', '8/21/2026']])
    )
    expect(recs[0].conditions).toBe(
      'Service Models: Software as a Service (SaaS). Status: Provisional Authorization'
    )
  })

  it('drops rows missing a provider or offering', () => {
    const recs = parseDcasWorkbook(
      workbook([
        ['Amazon', 'AWS', 'IL5', '', '', ''],
        ['', 'Orphan offering', 'IL5', '', '', ''],
        ['Orphan provider', '', 'IL5', '', '', ''],
      ])
    )
    expect(recs).toHaveLength(1)
    expect(recs[0].cspName).toBe('Amazon')
  })

  it('returns zero records for a header-only workbook', () => {
    // Worth pinning because it is indistinguishable from a healthy parse of an
    // empty marketplace. The caller must treat an empty result as suspect
    // rather than syncing it — DISA publishing a file with no authorizations
    // is not a thing that happens.
    expect(parseDcasWorkbook(workbook([]))).toHaveLength(0)
  })

  it('throws rather than returning nothing when handed a non-workbook', () => {
    expect(() => parseDcasWorkbook(Buffer.from('<html>404 Not Found</html>'))).toThrow()
  })
})

describe('DISA sync-log key', () => {
  it('writes the publish-date cache and the sync result to ONE row', async () => {
    await prisma.atoSyncLog.deleteMany({})
    await prisma.dodProvisionalAuth.deleteMany({})

    // The publish-date cache used to write source 'disa-xlsx' while the sync
    // wrote 'disa', so one pipeline produced two rows. The stale one kept its
    // original timestamp forever and check:sync graded it as months overdue,
    // reporting FAIL on a night the sync had actually succeeded.
    await rememberDcasDate('2026-07-08')
    await syncDisaData([
      {
        cspName: 'Amazon',
        csoName: 'AWS Test',
        impactLevel: 'IL5',
        paDate: null,
        paExpiration: null,
        sponsorComponent: 'DISA',
        conditions: null,
      },
    ])

    const rows = await prisma.atoSyncLog.findMany({
      where: { source: { in: ['disa', 'disa-xlsx'] } },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe(DISA_SYNC_SOURCE)

    // Both facts survive on the single row: the sync stamped it, and the
    // cursor still holds the discovered publish date.
    expect(rows[0].cursor).toBe('2026-07-08')
    expect(rows[0].status).toBe('success')
  })

  it('reads back the publish date it cached', async () => {
    await prisma.atoSyncLog.deleteMany({})
    await rememberDcasDate('2026-06-03')
    // Reader and writer must agree on the key, or every run re-probes the
    // full 120-day window instead of stopping at the known-good date.
    expect(await lastKnownDcasDate()).toBe('2026-06-03')
  })
})
