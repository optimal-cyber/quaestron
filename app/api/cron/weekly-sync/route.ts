import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { syncVendor } from '@/lib/vendor/sync-vendor'
import { requireCronRequest } from '@/lib/admin-auth'

/**
 * Weekly vendor refresh — keeps SBIR/STTR, federal contracts, SAM registration
 * and agency relationships from drifting stale (the old seed-* routes were
 * manual-only). Bounded per invocation for Vercel timeout budgets; processes
 * the stalest vendors first so successive weeks rotate through the universe.
 * Guarded by CRON_SECRET (Bearer), matching the daily-sync cron.
 */

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const cron = requireCronRequest(request)
  if (!cron.ok) return cron.response

  const sp = request.nextUrl.searchParams
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '25')))
  const staleAfterDays = parseInt(sp.get('staleDays') || '6')
  const staleBefore = new Date()
  staleBefore.setDate(staleBefore.getDate() - staleAfterDays)

  // Real vendors only (exclude agencies, investors); stalest first (nulls first).
  const vendors = await prisma.entity.findMany({
    where: {
      type: { notIn: ['GOVERNMENT', 'INVESTOR'] },
      OR: [{ vendorSyncedAt: null }, { vendorSyncedAt: { lt: staleBefore } }],
    },
    orderBy: [{ vendorSyncedAt: 'asc' }],
    take: limit,
    select: { name: true, uei: true },
  })

  const start = Date.now()
  let refreshed = 0
  let failed = 0
  const errors: string[] = []

  for (const v of vendors) {
    try {
      await syncVendor({ name: v.name, uei: v.uei ?? undefined, maxPages: 2 })
      refreshed++
    } catch (e) {
      failed++
      errors.push(`${v.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  await prisma.atoSyncLog.upsert({
    where: { source: 'weekly-sync' },
    create: {
      source: 'weekly-sync', lastSyncAt: new Date(),
      recordsAdded: refreshed, recordsUpdated: 0, recordsFailed: failed,
      status: failed > 0 && refreshed === 0 ? 'failed' : 'success',
    },
    update: {
      lastSyncAt: new Date(),
      recordsAdded: refreshed, recordsUpdated: 0, recordsFailed: failed,
      status: failed > 0 && refreshed === 0 ? 'failed' : 'success',
    },
  })

  return NextResponse.json({
    message: 'Weekly vendor sync complete',
    processed: vendors.length,
    refreshed,
    failed,
    elapsed: `${((Date.now() - start) / 1000).toFixed(1)}s`,
    errors: errors.slice(0, 20),
  })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
