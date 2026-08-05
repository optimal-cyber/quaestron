import { describe, it, expect } from 'vitest'
import { normalizeVendorName, slugify, vendorNamesMatch } from './vendor-name'

/**
 * Direct tests for the shared name normalizer.
 *
 * This existed untested while seven modules depended on it, including the ATO
 * matcher AND that matcher's own test fixture — both sides of those assertions
 * ran through this function, so its behaviour was never independently pinned.
 * That is a milder form of the failure that let a 404ing DCAS URL ship: an
 * expectation derived from the same code it is meant to check.
 *
 * Every expected value below is a literal string.
 */

describe('normalizeVendorName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeVendorName('  Palantir   Technologies  ')).toBe('palantir')
  })

  it('drops corporate suffixes that carry no identity', () => {
    expect(normalizeVendorName('Datadog, Inc.')).toBe('datadog')
    expect(normalizeVendorName('Veritas Technologies, LLC')).toBe('veritas')
    expect(normalizeVendorName('Beryllium InfoSec, Inc.')).toBe('beryllium infosec')
    expect(normalizeVendorName('DOMA Technologies, LLC')).toBe('doma')
  })

  it('strips punctuation to spaces rather than deleting it', () => {
    // Deleting would fuse tokens: "Smith-Jones" must not become "smithjones",
    // or it stops matching "Smith Jones".
    expect(normalizeVendorName('Smith-Jones')).toBe('smith jones')
    // '&' is in the punctuation class, so AT&T becomes two tokens. Pinning the
    // actual behaviour rather than the intuitive one — this is what the matcher
    // and every caller actually sees.
    expect(normalizeVendorName('AT&T')).toBe('at t')
  })

  it('keeps distinct companies distinct', () => {
    // The matcher's real past false positives. If normalization collapses these
    // pairs, no amount of scoring downstream can separate them again.
    expect(normalizeVendorName('Salesforce')).not.toBe(normalizeVendorName('Salesforce Ventures'))
    expect(normalizeVendorName('Amazon')).not.toBe(normalizeVendorName('Ring'))
    expect(normalizeVendorName('Google')).not.toBe(normalizeVendorName('Google Cloud'))
  })

  it('collapses only genuine spelling variants of the same company', () => {
    expect(normalizeVendorName('Palantir Technologies Inc.')).toBe(
      normalizeVendorName('Palantir Technologies, Incorporated')
    )
    expect(normalizeVendorName('Project Hosts Inc.')).toBe(normalizeVendorName('Project Hosts'))
  })

  it('falls back to the cleaned string when every token is noise', () => {
    // "Federal Systems Group" is entirely noise words. Returning "" would map
    // every such company to the same empty key and match them all to each other.
    expect(normalizeVendorName('Federal Systems Group')).toBe('federal systems group')
    expect(normalizeVendorName('The Group')).toBe('the group')
  })

  it('returns empty for input with no usable characters', () => {
    expect(normalizeVendorName('')).toBe('')
    expect(normalizeVendorName('   ')).toBe('')
    expect(normalizeVendorName('...')).toBe('')
  })

  it('is idempotent', () => {
    // The matcher normalizes both stored names and incoming queries; if a second
    // pass differed, a re-indexed name would stop matching itself.
    for (const name of ['Palantir Technologies Inc.', 'AT&T', 'Federal Systems Group', '']) {
      expect(normalizeVendorName(normalizeVendorName(name))).toBe(normalizeVendorName(name))
    }
  })
})

describe('slugify', () => {
  it('produces URL-safe slugs', () => {
    expect(slugify('Palantir Technologies Inc.')).toBe('palantir-technologies-inc')
    expect(slugify('AT&T Government Solutions')).toBe('at-t-government-solutions')
  })

  it('does not strip noise words', () => {
    // Slugs are public URLs and must stay stable; they are not match keys.
    expect(slugify('Veritas Technologies LLC')).toBe('veritas-technologies-llc')
  })
})

describe('vendorNamesMatch', () => {
  it('matches across suffix and punctuation variation', () => {
    expect(vendorNamesMatch('Datadog, Inc.', 'Datadog')).toBe(true)
    expect(vendorNamesMatch('Palantir Technologies Inc.', 'Palantir')).toBe(true)
  })

  it('MATCHES a parent to its subsidiary — asserted as-is, and it is wrong', () => {
    // The prefix test runs in both directions, so "Salesforce" resolves to
    // "Salesforce Ventures" and "Google" to "Google Cloud". This is the exact
    // false-positive shape the ATO matcher was hardened against, where the
    // prefix check was made one-directional.
    //
    // Reachable from resolveEntity in aliases.ts only when the exact name is
    // absent and a longer one exists, so it mis-attributes rather than
    // duplicating. Pinned here as current behaviour, not endorsed — see the
    // tracking issue. Flip these to false when the direction is fixed.
    expect(vendorNamesMatch('Salesforce', 'Salesforce Ventures')).toBe(true)
    expect(vendorNamesMatch('Google', 'Google Cloud')).toBe(true)
  })
})
