import { NextRequest, NextResponse } from 'next/server'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

interface FeedSource {
  name: string
  url: string
  category: 'CYBER' | 'DEFENSE' | 'OSINT' | 'SURVEILLANCE' | 'POLICY' | 'THREAT_INTEL' | 'VULN' | 'AI_POLICY'
}

interface FeedItem {
  title: string
  link: string
  pubDate: string
  source: string
  category: string
  description: string
}

const FEEDS: FeedSource[] = [
  // ── Cybersecurity ───────────────────────────────────────────
  { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', category: 'CYBER' },
  { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', category: 'CYBER' },
  { name: 'Schneier on Security', url: 'https://www.schneier.com/feed/atom/', category: 'CYBER' },
  { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', category: 'CYBER' },
  { name: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml', category: 'CYBER' },
  { name: 'SecurityWeek', url: 'https://feeds.feedburner.com/securityweek', category: 'CYBER' },
  { name: 'Naked Security', url: 'https://nakedsecurity.sophos.com/feed/', category: 'CYBER' },
  { name: 'Ars Technica Security', url: 'https://feeds.arstechnica.com/arstechnica/security', category: 'CYBER' },
  { name: 'Wired - Security', url: 'https://www.wired.com/feed/category/security/latest/rss', category: 'CYBER' },
  { name: 'Infosecurity Magazine', url: 'https://www.infosecurity-magazine.com/rss/news/', category: 'CYBER' },
  { name: 'CSO Online', url: 'https://www.csoonline.com/feed/', category: 'CYBER' },
  { name: 'The Record by Recorded Future', url: 'https://therecord.media/feed', category: 'CYBER' },
  { name: 'Graham Cluley', url: 'https://grahamcluley.com/feed/', category: 'CYBER' },
  { name: 'TripWire State of Security', url: 'https://www.tripwire.com/state-of-security/feed', category: 'CYBER' },

  // ── Threat Intelligence ─────────────────────────────────────
  { name: 'CISA Alerts', url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml', category: 'THREAT_INTEL' },
  // CISA KEV handled separately as JSON below
  { name: 'Cisco Talos', url: 'https://blog.talosintelligence.com/feeds/posts/default?alt=rss', category: 'THREAT_INTEL' },
  { name: 'Unit 42 (Palo Alto)', url: 'https://unit42.paloaltonetworks.com/feed/', category: 'THREAT_INTEL' },
  { name: 'Mandiant Blog', url: 'https://www.mandiant.com/resources/blog/rss.xml', category: 'THREAT_INTEL' },
  { name: 'SentinelOne Labs', url: 'https://www.sentinelone.com/labs/feed/', category: 'THREAT_INTEL' },
  { name: 'CrowdStrike Blog', url: 'https://www.crowdstrike.com/blog/feed/', category: 'THREAT_INTEL' },
  { name: 'Microsoft Threat Intel', url: 'https://www.microsoft.com/en-us/security/blog/feed/', category: 'THREAT_INTEL' },
  { name: 'Google TAG', url: 'https://blog.google/threat-analysis-group/rss/', category: 'THREAT_INTEL' },
  { name: 'Securelist (Kaspersky)', url: 'https://securelist.com/feed/', category: 'THREAT_INTEL' },
  { name: 'WeLiveSecurity (ESET)', url: 'https://www.welivesecurity.com/en/feed/', category: 'THREAT_INTEL' },
  { name: 'Proofpoint Threat Insight', url: 'https://www.proofpoint.com/us/blog/threat-insight/feed', category: 'THREAT_INTEL' },
  { name: 'Elastic Security Labs', url: 'https://www.elastic.co/security-labs/rss/feed.xml', category: 'THREAT_INTEL' },

  // ── Vulnerabilities ─────────────────────────────────────────
  { name: 'Packet Storm Security', url: 'https://rss.packetstormsecurity.com/news/', category: 'VULN' },
  { name: 'Exploit-DB', url: 'https://www.exploit-db.com/rss.xml', category: 'VULN' },
  { name: 'Full Disclosure', url: 'https://seclists.org/rss/fulldisclosure.rss', category: 'VULN' },
  { name: 'Zero Day Initiative', url: 'https://www.zerodayinitiative.com/blog?format=rss', category: 'VULN' },

  // ── OSINT ───────────────────────────────────────────────────
  { name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/', category: 'OSINT' },
  { name: 'IntelligenceOnline', url: 'https://www.intelligenceonline.com/rss', category: 'OSINT' },
  { name: 'OSINT Curious', url: 'https://osintcurio.us/feed/', category: 'OSINT' },
  { name: 'Sector035 OSINT', url: 'https://sector035.nl/feed.xml', category: 'OSINT' },
  { name: 'Nixintel OSINT', url: 'https://nixintel.info/feed/', category: 'OSINT' },

  // ── Defense ─────────────────────────────────────────────────
  { name: 'Defense One', url: 'https://www.defenseone.com/rss/technology/', category: 'DEFENSE' },
  { name: 'Breaking Defense', url: 'https://breakingdefense.com/feed/', category: 'DEFENSE' },
  { name: 'C4ISRNET', url: 'https://www.c4isrnet.com/arc/outboundfeeds/rss/?outputType=xml', category: 'DEFENSE' },
  { name: 'Defense News', url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml', category: 'DEFENSE' },
  { name: 'Janes', url: 'https://www.janes.com/feeds/news', category: 'DEFENSE' },
  { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/', category: 'DEFENSE' },

  // ── Surveillance & Privacy ──────────────────────────────────
  { name: 'EFF Deeplinks', url: 'https://www.eff.org/rss/updates.xml', category: 'SURVEILLANCE' },
  { name: 'The Intercept', url: 'https://theintercept.com/feed/?rss', category: 'SURVEILLANCE' },
  { name: 'Privacy News Online', url: 'https://www.privateinternetaccess.com/blog/feed/', category: 'SURVEILLANCE' },
  { name: 'Restore The Fourth', url: 'https://restorethe4th.com/feed/', category: 'SURVEILLANCE' },

  // ── Policy, Executive Orders & AI Governance ────────────────
  { name: 'Lawfare', url: 'https://www.lawfaremedia.org/feed', category: 'POLICY' },
  { name: 'Council on Foreign Relations Cyber', url: 'https://www.cfr.org/rss/cyber-brief', category: 'POLICY' },
  { name: 'Brookings TechStream', url: 'https://www.brookings.edu/topic/cybersecurity/feed/', category: 'POLICY' },
  { name: 'CSIS Tech Policy', url: 'https://www.csis.org/topics/technology-policy/feed', category: 'POLICY' },
  { name: 'White House Briefing Room', url: 'https://www.whitehouse.gov/feed/', category: 'POLICY' },
  { name: 'Federal Register - Executive Orders', url: 'https://www.federalregister.gov/documents/search.atom?conditions%5Bpresidential_document_type%5D=executive_order&conditions%5Btype%5D=PRESDOCU', category: 'POLICY' },
  { name: 'NIST Cybersecurity', url: 'https://www.nist.gov/blogs/cybersecurity-insights/rss.xml', category: 'POLICY' },
  { name: 'GAO - IT & Cybersecurity', url: 'https://www.gao.gov/rss/topic/information-technology.xml', category: 'POLICY' },
  { name: 'CRS Reports', url: 'https://crsreports.congress.gov/rss/NewCRSReports', category: 'POLICY' },

  // ── AI Policy & Governance ──────────────────────────────────
  { name: 'OECD AI Policy Observatory', url: 'https://oecd.ai/en/feed', category: 'AI_POLICY' },
  { name: 'Stanford HAI', url: 'https://hai.stanford.edu/news/rss.xml', category: 'AI_POLICY' },
  { name: 'MIT Tech Review - AI', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', category: 'AI_POLICY' },
  { name: 'AI Now Institute', url: 'https://ainowinstitute.org/feed', category: 'AI_POLICY' },
  { name: 'Center for AI Safety', url: 'https://www.safe.ai/blog/rss.xml', category: 'AI_POLICY' },
  { name: 'RAND AI Policy', url: 'https://www.rand.org/topics/artificial-intelligence/feed.xml', category: 'AI_POLICY' },
  { name: 'Georgetown CSET', url: 'https://cset.georgetown.edu/feed/', category: 'AI_POLICY' },
  { name: 'Brookings AI', url: 'https://www.brookings.edu/topic/artificial-intelligence/feed/', category: 'AI_POLICY' },
]

function parseRSSItems(xml: string, source: string, category: string): FeedItem[] {
  const items: FeedItem[] = []

  // Parse RSS <item> elements
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi
  let match

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1]

    const title = extractTag(itemXml, 'title')
    const link = extractTag(itemXml, 'link') || extractAtomLink(itemXml)
    const pubDate = extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'published') || extractTag(itemXml, 'updated') || ''
    const description = extractTag(itemXml, 'description') || extractTag(itemXml, 'summary') || ''

    if (title && link) {
      items.push({
        title: cleanHtml(title),
        link: cleanHtml(link).trim(),
        pubDate,
        source,
        category,
        description: cleanHtml(description).slice(0, 200),
      })
    }
  }

  // Also try Atom <entry> elements
  const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi
  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1]

    const title = extractTag(entryXml, 'title')
    const link = extractAtomLink(entryXml) || extractTag(entryXml, 'link')
    const pubDate = extractTag(entryXml, 'published') || extractTag(entryXml, 'updated') || ''
    const description = extractTag(entryXml, 'summary') || extractTag(entryXml, 'content') || ''

    if (title && link) {
      items.push({
        title: cleanHtml(title),
        link: cleanHtml(link).trim(),
        pubDate,
        source,
        category,
        description: cleanHtml(description).slice(0, 200),
      })
    }
  }

  return items.slice(0, 8) // Max 8 per feed
}

function extractTag(xml: string, tag: string): string {
  // Try CDATA first
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i')
  const cdataMatch = xml.match(cdataRegex)
  if (cdataMatch) return cdataMatch[1]

  // Regular tag
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(regex)
  return match ? match[1] : ''
}

function extractAtomLink(xml: string): string {
  const match = xml.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i)
  return match ? match[1] : ''
}

function cleanHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/\n\s*\n/g, '\n')
    .trim()
}

/**
 * Aggregated RSS/Atom intel feed.
 *
 * A cache miss fans out to ~62 third-party hosts. The Next.js Data Cache
 * (`next.revalidate: 900` on each fetch) absorbs the common case — repeats
 * inside a 15-minute window are served without touching upstream, shared across
 * instances — so this is not one fan-out per pageview. The rate limit bounds
 * what a caller can do when the cache is cold, which is the only window in
 * which this endpoint can act as an amplifier.
 *
 * Serving from a table populated on a schedule would remove the fan-out from
 * the request path entirely, and would also make /intel resilient to an
 * upstream host being down rather than silently dropping that source. Tracked
 * separately; the limit is the security-relevant part.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.intelFeeds)
  if (limited.response) return limited.response

  const results: FeedItem[] = []

  const feedPromises = FEEDS.map(async (feed) => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      const res = await fetch(feed.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Quaestron/1.0 RSS Reader' },
        next: { revalidate: 900 }, // Cache 15 min
      })
      clearTimeout(timeout)

      if (!res.ok) return []

      const xml = await res.text()
      return parseRSSItems(xml, feed.name, feed.category)
    } catch {
      return []
    }
  })

  // Fetch CISA KEV (JSON format)
  const kevPromise = (async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', {
        signal: controller.signal,
        headers: { 'User-Agent': 'Quaestron/1.0 RSS Reader' },
        next: { revalidate: 900 },
      })
      clearTimeout(timeout)
      if (!res.ok) return []
      const data = await res.json()
      const vulns = (data.vulnerabilities || []).slice(0, 8)
      return vulns.map((v: { cveID?: string; vendorProject?: string; product?: string; shortDescription?: string; dateAdded?: string }) => ({
        title: `${v.cveID || 'CVE'}: ${v.vendorProject || ''} ${v.product || ''} — Known Exploited`,
        link: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
        pubDate: v.dateAdded ? new Date(v.dateAdded).toISOString() : '',
        source: 'CISA KEV',
        category: 'THREAT_INTEL',
        description: (v.shortDescription || '').slice(0, 200),
      }))
    } catch {
      return []
    }
  })()

  const feedResults = await Promise.allSettled([...feedPromises, kevPromise])
  for (const result of feedResults) {
    if (result.status === 'fulfilled') {
      results.push(...result.value)
    }
  }

  // Sort by date (newest first)
  results.sort((a, b) => {
    const dateA = new Date(a.pubDate).getTime() || 0
    const dateB = new Date(b.pubDate).getTime() || 0
    return dateB - dateA
  })

  return NextResponse.json(
    {
      items: results,
      sources: FEEDS.map((f) => ({ name: f.name, category: f.category })),
      fetchedAt: new Date().toISOString(),
    },
    { headers: limited.headers }
  )
}
