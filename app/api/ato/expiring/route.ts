import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Rows whose offering has left the DCAS file. `source` is a provenance field
// being overloaded as a stopgap until #15 adds lifecycleState; the point is that
// a withdrawn authorization must not read as a current one, and that cannot wait
// for a schema change.
const NOT_WITHDRAWN = { source: { not: 'withdrawn-pending-review' } }

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const days = parseInt(sp.get('days') || '180')
    const source = sp.get('source')

    const now = new Date()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + days)

    const expirationWindow = {
      gte: now,
      lte: cutoff,
    }

    const results: Array<{
      name: string
      type: string
      source: string
      expirationDate: Date
      impactLevel: string | null
      daysRemaining: number
    }> = []

    // Query FedRAMP authorizations
    if (!source || source === 'fedramp') {
      const fedrampRecords = await prisma.fedrampAuthorization.findMany({
        where: { expirationDate: expirationWindow },
      })
      for (const r of fedrampRecords) {
        if (!r.expirationDate) continue
        results.push({
          name: `${r.csoName} (${r.cspName})`,
          type: 'FedRAMP',
          source: 'fedramp',
          expirationDate: r.expirationDate,
          impactLevel: r.impactLevel,
          daysRemaining: Math.ceil(
            (r.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          ),
        })
      }
    }

    // Query DoD Provisional Authorizations
    if (!source || source === 'dod-pa') {
      const dodRecords = await prisma.dodProvisionalAuth.findMany({
        where: { paExpiration: expirationWindow, ...NOT_WITHDRAWN },
      })
      for (const r of dodRecords) {
        if (!r.paExpiration) continue
        results.push({
          name: `${r.csoName} (${r.cspName})`,
          type: 'DoD PA',
          source: 'dod-pa',
          expirationDate: r.paExpiration,
          impactLevel: r.impactLevel,
          daysRemaining: Math.ceil(
            (r.paExpiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          ),
        })
      }
    }

    // Query eMASS authorizations
    if (!source || source === 'emass') {
      const emassRecords = await prisma.emassAuthorization.findMany({
        where: { expirationDate: expirationWindow },
      })
      for (const r of emassRecords) {
        if (!r.expirationDate) continue
        results.push({
          name: r.systemName,
          type: r.authorizationType,
          source: 'emass',
          expirationDate: r.expirationDate,
          impactLevel: r.impactLevel,
          daysRemaining: Math.ceil(
            (r.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          ),
        })
      }
    }

    // Sort by expirationDate ascending
    results.sort((a, b) => a.expirationDate.getTime() - b.expirationDate.getTime())

    return NextResponse.json({ authorizations: results, total: results.length })
  } catch (error) {
    console.error('[ATO] Error fetching expiring authorizations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch expiring authorizations' },
      { status: 500 }
    )
  }
}
