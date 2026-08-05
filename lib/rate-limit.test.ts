import { describe, it, expect } from 'vitest'
import { RATE_LIMITS, clientId } from './rate-limit'

/**
 * These cover the parts of the limiter that are easy to break silently: the
 * bucket names (a duplicate would merge two endpoints into one shared budget)
 * and client identification (a wrong first-hop parse limits everyone as one).
 */
describe('RATE_LIMITS', () => {
  it('has a unique bucket per rule', () => {
    const buckets = Object.values(RATE_LIMITS).map((r) => r.bucket)
    expect(new Set(buckets).size).toBe(buckets.length)
  })

  it('sets every limit and window above zero', () => {
    for (const [name, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.limit, `${name}.limit`).toBeGreaterThan(0)
      expect(rule.windowSeconds, `${name}.windowSeconds`).toBeGreaterThan(0)
    }
  })

  it('keeps the unauthenticated write tighter than the read endpoints', () => {
    // Per-second budget: a public write must never be cheaper than a read.
    const rate = (r: { limit: number; windowSeconds: number }) => r.limit / r.windowSeconds
    expect(rate(RATE_LIMITS.submissions)).toBeLessThan(rate(RATE_LIMITS.search))
    expect(rate(RATE_LIMITS.submissions)).toBeLessThan(rate(RATE_LIMITS.entities))
  })

  it('keeps third-party-fanout endpoints tighter than plain DB reads', () => {
    const rate = (r: { limit: number; windowSeconds: number }) => r.limit / r.windowSeconds
    // geocode and intel-feeds can reach third-party hosts; entities only reads Turso.
    expect(rate(RATE_LIMITS.geocode)).toBeLessThan(rate(RATE_LIMITS.entities))
    expect(rate(RATE_LIMITS.intelFeeds)).toBeLessThan(rate(RATE_LIMITS.entities))
  })
})

describe('clientId', () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://quaestron.io/api/test', { headers })

  it('takes the first hop of x-forwarded-for', () => {
    // The left-most entry is the original client; later hops are proxies. Using
    // the last would bucket every request behind one proxy IP together.
    expect(clientId(req({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' }))).toBe(
      '203.0.113.7'
    )
  })

  it('trims whitespace around the first hop', () => {
    expect(clientId(req({ 'x-forwarded-for': '  203.0.113.7 , 70.41.3.18' }))).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip when forwarded-for is absent', () => {
    expect(clientId(req({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })

  it('falls back to x-real-ip when forwarded-for is empty', () => {
    expect(clientId(req({ 'x-forwarded-for': '', 'x-real-ip': '198.51.100.4' }))).toBe(
      '198.51.100.4'
    )
  })

  it('returns a shared bucket when no identifying header is present', () => {
    // Everyone lands in one bucket rather than nobody being limited at all.
    expect(clientId(req({}))).toBe('unknown')
  })
})
