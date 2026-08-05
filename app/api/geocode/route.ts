import { NextRequest, NextResponse } from 'next/server'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * City/country → lat/lon via Nominatim.
 *
 * Two caches sit in front of the upstream call, because Nominatim enforces its
 * usage policy by IP ban and the ban lands on this deployment, not on whoever
 * hammered the endpoint:
 *
 *   1. The Next.js Data Cache (`next.revalidate`), shared across instances and
 *      surviving cold starts.
 *   2. A per-instance Map, which absorbs repeats inside a warm instance without
 *      entering the fetch machinery at all.
 *
 * The rate limit bounds cache misses — the only requests that reach Nominatim.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** Bounded so a hostile caller cannot grow this without limit on a warm instance. */
const MAX_CACHE_ENTRIES = 5_000

type Coords = { lat: number; lon: number } | null
const geocodeCache = new Map<string, { value: Coords; expiresAt: number }>()

function readCache(key: string): { hit: boolean; value: Coords } {
  const entry = geocodeCache.get(key)
  if (!entry) return { hit: false, value: null }
  // Negative results were previously cached with no expiry, so one transient
  // Nominatim failure pinned a city to "unknown" for the life of the instance.
  if (entry.expiresAt <= Date.now()) {
    geocodeCache.delete(key)
    return { hit: false, value: null }
  }
  return { hit: true, value: entry.value }
}

function writeCache(key: string, value: Coords) {
  if (geocodeCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = geocodeCache.keys().next()
    if (!oldest.done) geocodeCache.delete(oldest.value)
  }
  geocodeCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const city = searchParams.get('city')?.trim()
  const country = searchParams.get('country')?.trim() || ''

  if (!city) {
    return NextResponse.json({ error: 'city parameter required' }, { status: 400 })
  }
  // Long inputs are never real place names; they are cache-busting attempts.
  if (city.length > 120 || country.length > 120) {
    return NextResponse.json({ error: 'city or country too long' }, { status: 400 })
  }

  const cacheKey = `${city.toLowerCase()}|${country.toLowerCase()}`
  const cached = readCache(cacheKey)
  if (cached.hit) {
    return NextResponse.json(
      cached.value ? { lat: cached.value.lat, lon: cached.value.lon } : { lat: null, lon: null }
    )
  }

  // Only misses can reach upstream, so only misses are rate limited. A page
  // rendering many known cities is never throttled.
  const limited = await enforceRateLimit(request, RATE_LIMITS.geocode)
  if (limited.response) return limited.response

  try {
    const query = country ? `${city}, ${country}` : city
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Quaestron/1.0 (defense-market-intelligence)' },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      writeCache(cacheKey, null)
      return NextResponse.json({ lat: null, lon: null }, { headers: limited.headers })
    }

    const data = await res.json()

    if (Array.isArray(data) && data.length > 0) {
      const lat = parseFloat(data[0].lat)
      const lon = parseFloat(data[0].lon)
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        writeCache(cacheKey, { lat, lon })
        return NextResponse.json({ lat, lon }, { headers: limited.headers })
      }
    }

    writeCache(cacheKey, null)
    return NextResponse.json({ lat: null, lon: null }, { headers: limited.headers })
  } catch {
    // Not cached: a timeout says nothing about whether the place exists.
    return NextResponse.json({ lat: null, lon: null }, { headers: limited.headers })
  }
}
