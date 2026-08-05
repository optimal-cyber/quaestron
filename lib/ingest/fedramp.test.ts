import { describe, it, expect } from 'vitest'
import { parseAnnualAssessment } from './fedramp'

/**
 * `annual_assessment` parsing.
 *
 * The FedRAMP feed publishes this field as a bare month/day recurrence
 * ("09/30") — the anniversary the assessment is due, not a full date. A plain
 * `new Date("09/30")` yields September **2001**, which is how the column ended
 * up full of two-decade-old dates that looked real to every downstream
 * consumer and silently disabled every expiry-driven feature.
 *
 * `now` is injected on every case so the suite is deterministic — these
 * assertions must not start failing in January.
 */

// Mid-year so both the "still ahead" and "already passed" branches are reachable.
const NOW = new Date('2026-08-04T12:00:00Z')

function iso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

describe('parseAnnualAssessment — month/day recurrence', () => {
  it('resolves a date later this year to this year', () => {
    expect(iso(parseAnnualAssessment('09/30', NOW))).toBe('2026-09-30')
  })

  it('rolls a date already past to next year', () => {
    expect(iso(parseAnnualAssessment('03/11', NOW))).toBe('2027-03-11')
  })

  it('treats today as still due today, not next year', () => {
    expect(iso(parseAnnualAssessment('08/04', NOW))).toBe('2026-08-04')
  })

  it('accepts single-digit days and months', () => {
    expect(iso(parseAnnualAssessment('12/1', NOW))).toBe('2026-12-01')
    expect(iso(parseAnnualAssessment('9/5', NOW))).toBe('2026-09-05')
  })

  it('never returns a date in the past', () => {
    for (let month = 1; month <= 12; month++) {
      const parsed = parseAnnualAssessment(`${month}/15`, NOW)
      expect(parsed).not.toBeNull()
      expect(parsed!.getTime()).toBeGreaterThanOrEqual(
        Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate())
      )
    }
  })

  it('regression: never yields the year 2001', () => {
    // The original bug. new Date("09/30") === Sep 30 2001.
    for (const value of ['09/30', '01/31', '12/12', '02/28']) {
      const parsed = parseAnnualAssessment(value, NOW)
      expect(parsed!.getUTCFullYear()).toBeGreaterThanOrEqual(NOW.getUTCFullYear())
    }
  })
})

describe('parseAnnualAssessment — full dates', () => {
  it('passes an ISO datetime through unchanged', () => {
    expect(iso(parseAnnualAssessment('2024-03-17T20:00:00.000Z', NOW))).toBe('2024-03-17')
  })

  it('accepts a bare ISO date', () => {
    expect(iso(parseAnnualAssessment('2027-01-15', NOW))).toBe('2027-01-15')
  })

  it('does not roll a full date forward — a past assessment is genuinely overdue', () => {
    expect(iso(parseAnnualAssessment('2024-01-01', NOW))).toBe('2024-01-01')
  })
})

describe('parseAnnualAssessment — rejects rather than inventing a date', () => {
  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['sentinel', 'Continuous ATO'],
    ['prose', 'not a date'],
    ['month 13', '13/01'],
    ['month 0', '0/15'],
    ['day 0', '05/0'],
    ['day 32', '05/32'],
    ['impossible Feb 30', '02/30'],
    ['impossible Apr 31', '04/31'],
    ['partial', '09/'],
    ['three parts', '09/30/2026'],
  ])('returns null for %s', (_label, value) => {
    expect(parseAnnualAssessment(value, NOW)).toBeNull()
  })

  it.each([null, undefined])('returns null for %j', (value) => {
    expect(parseAnnualAssessment(value, NOW)).toBeNull()
  })

  it('never silently rolls Feb 29 into March', () => {
    // Feb 29 already passed in 2026 (not a leap year); next year is not one either.
    const parsed = parseAnnualAssessment('02/29', new Date('2026-03-01T12:00:00Z'))
    if (parsed !== null) expect(parsed.getUTCMonth()).toBe(1) // February, never March
  })

  it('resolves Feb 29 correctly inside a leap year', () => {
    expect(iso(parseAnnualAssessment('02/29', new Date('2028-01-10T12:00:00Z')))).toBe('2028-02-29')
  })
})
