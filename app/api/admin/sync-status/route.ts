import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'

// Sync endpoints surfaced in the admin panel. Each maps to a POST handler
// at /api/admin/sync/<source>. Listed here so SYNC NOW buttons render even
// before a source has run for the first time.
const KNOWN_SOURCES = ['fedramp', 'disa', 'disa-seed'] as const

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request)
  if (!admin.ok) return admin.response

  try {
    const [logs, fedramp, dodPa, emass, contracts, companies] = await Promise.all([
      prisma.atoSyncLog.findMany({
        orderBy: { lastSyncAt: 'desc' },
      }),
      prisma.fedrampAuthorization.count(),
      prisma.dodProvisionalAuth.count(),
      prisma.emassAuthorization.count(),
      prisma.federalContract.count(),
      prisma.atoCompany.count(),
    ])

    type SyncRow = {
      id: string
      source: string
      lastSyncAt: Date | null
      recordsAdded: number
      recordsUpdated: number
      recordsFailed: number
      status: string
    }

    const byName = new Map<string, SyncRow>(logs.map((l) => [l.source, l as SyncRow]))
    for (const source of KNOWN_SOURCES) {
      if (!byName.has(source)) {
        byName.set(source, {
          id: `placeholder:${source}`,
          source,
          lastSyncAt: null,
          recordsAdded: 0,
          recordsUpdated: 0,
          recordsFailed: 0,
          status: 'pending',
        })
      }
    }

    const sources = Array.from(byName.values()).sort((a, b) => {
      const ad = a.lastSyncAt ? new Date(a.lastSyncAt).getTime() : 0
      const bd = b.lastSyncAt ? new Date(b.lastSyncAt).getTime() : 0
      return bd - ad
    })

    return NextResponse.json({
      sources,
      counts: {
        fedramp,
        dodPa,
        emass,
        contracts,
        companies,
      },
    })
  } catch (error) {
    console.error('[ATO] Error fetching sync status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sync status' },
      { status: 500 }
    )
  }
}
