import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { fetchLatestDcasXlsx, parseDcasWorkbook, syncDisaData } from '@/lib/ingest/disa'
import { fetchFromGitHub, syncFedrampData, fedrampResumeCursor } from '@/lib/ingest/fedramp'
import { requireCronRequest } from '@/lib/admin-auth'
import { runAlertEngine } from '@/lib/alerts/engine'
import { sendDigests } from '@/lib/alerts/digest'

// Explicit for intent. 300s is both the default and the maximum on Hobby with
// fluid compute, so this documents the ceiling rather than raising it.
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const cron = requireCronRequest(request)
  if (!cron.ok) return cron.response

  // The function ceiling is 300s (Hobby + fluid compute; also the maximum).
  // Each step gets an explicit slice so no single one can starve the rest, and
  // the FedRAMP loop stops on its slice rather than being killed mid-write.
  const RUN_STARTED = Date.now()
  const TOTAL_BUDGET_MS = 300_000
  const SAFETY_MARGIN_MS = 45_000
  const FEDRAMP_SLICE_MS = 150_000

  try {
    const summary: Record<string, unknown> = {}
    summary.budget = { totalMs: TOTAL_BUDGET_MS, fedrampSliceMs: FEDRAMP_SLICE_MS }

    // ── Step 1: FedRAMP sync from GitHub ──────────────────────────────
    // Delegates to lib/ingest/fedramp.ts rather than mapping inline. This route
    // used to carry its own copy of the field mapping, and the two drifted:
    // the shared module hardcoded `expirationDate: null` while this one read
    // `annual_assessment`, so whichever path last wrote a row decided whether
    // expiry data existed at all. One mapping, one place.
    try {
      console.log('[ATO] Fetching FedRAMP data from GitHub...')
      const { data, sourceLabel } = await fetchFromGitHub()
      const cursor = await fedrampResumeCursor()
      console.log(
        `[ATO] Processing ${data.length} FedRAMP records from ${sourceLabel}` +
          (cursor ? ` (resuming after ${cursor})` : '')
      )
      const result = await syncFedrampData(data, {
        deadline: RUN_STARTED + FEDRAMP_SLICE_MS,
        cursor,
      })
      summary.fedramp = {
        added: result.added,
        updated: result.updated,
        failed: result.failed,
        processed: result.processed,
        completed: result.completed,
        // Present only on a partial run; the next invocation starts here rather
        // than repeating the same prefix forever.
        resumeAfter: result.cursor,
        source: sourceLabel,
      }
    } catch (err) {
      console.error('[ATO] FedRAMP sync failed:', err)
      summary.fedramp = { error: err instanceof Error ? err.message : String(err) }

      await prisma.atoSyncLog.upsert({
        where: { source: 'fedramp' },
        create: { source: 'fedramp', lastSyncAt: new Date(), recordsFailed: 0, status: 'failed' },
        update: { lastSyncAt: new Date(), status: 'failed' },
      })
    }

    // ── Step 2: DISA DCAS sync (probe dl.dod.cyber.mil) ───────────────
    // Skipped when FedRAMP used the budget. DISA is once-every-few-months data;
    // losing a day of it costs far less than being killed mid-run and leaving
    // the alert steps below unexecuted.
    const budgetLeft = () => TOTAL_BUDGET_MS - (Date.now() - RUN_STARTED)
    if (budgetLeft() < SAFETY_MARGIN_MS) {
      console.warn('[ATO] Skipping DISA sync — insufficient budget remaining')
      summary.disa = { skipped: 'insufficient budget remaining' }
    } else try {
      console.log('[ATO] Probing dl.dod.cyber.mil for latest DCAS xlsx...')
      const { buffer, url } = await fetchLatestDcasXlsx()
      const records = parseDcasWorkbook(buffer)
      const result = await syncDisaData(records)
      summary.disa = { source: url, ...result, errors: undefined }
    } catch (err) {
      console.error('[ATO] DISA sync failed:', err)
      summary.disa = { error: err instanceof Error ? err.message : String(err) }

      await prisma.atoSyncLog.upsert({
        where: { source: 'disa' },
        create: {
          source: 'disa',
          lastSyncAt: new Date(),
          status: 'failed',
        },
        update: {
          lastSyncAt: new Date(),
          status: 'failed',
        },
      })
    }

    // ── Step 3: Generate expiration alerts ────────────────────────────
    let alertsCreated = 0

    try {
      const now = new Date()
      const thirtyDays = new Date()
      thirtyDays.setDate(thirtyDays.getDate() + 30)
      const ninetyDays = new Date()
      ninetyDays.setDate(ninetyDays.getDate() + 90)

      // Collect expiring records from all sources
      const [fedramp30, fedramp90, dod30, dod90, emass30, emass90] = await Promise.all([
        prisma.fedrampAuthorization.findMany({
          where: { expirationDate: { gte: now, lte: thirtyDays } },
        }),
        prisma.fedrampAuthorization.findMany({
          where: { expirationDate: { gt: thirtyDays, lte: ninetyDays } },
        }),
        prisma.dodProvisionalAuth.findMany({
          where: { paExpiration: { gte: now, lte: thirtyDays } },
        }),
        prisma.dodProvisionalAuth.findMany({
          where: { paExpiration: { gt: thirtyDays, lte: ninetyDays } },
        }),
        prisma.emassAuthorization.findMany({
          where: { expirationDate: { gte: now, lte: thirtyDays } },
        }),
        prisma.emassAuthorization.findMany({
          where: { expirationDate: { gt: thirtyDays, lte: ninetyDays } },
        }),
      ])

      // Create 30-day alerts
      const thirtyDayItems = [
        ...fedramp30.map((r) => ({ name: r.csoName, source: 'fedramp', date: r.expirationDate })),
        ...dod30.map((r) => ({ name: `${r.csoName} ${r.impactLevel}`, source: 'dod-pa', date: r.paExpiration })),
        ...emass30.map((r) => ({ name: r.systemName, source: 'emass', date: r.expirationDate })),
      ]

      for (const item of thirtyDayItems) {
        try {
          await prisma.atoAlert.create({
            data: {
              type: 'expiring_30d',
              title: `${item.name} expires within 30 days`,
              details: JSON.stringify({
                name: item.name,
                expirationDate: item.date,
              }),
              source: item.source,
            },
          })
          alertsCreated++
        } catch (err) {
          console.error('[ATO] Alert creation error (30d):', err)
        }
      }

      // Create 90-day alerts
      const ninetyDayItems = [
        ...fedramp90.map((r) => ({ name: r.csoName, source: 'fedramp', date: r.expirationDate })),
        ...dod90.map((r) => ({ name: `${r.csoName} ${r.impactLevel}`, source: 'dod-pa', date: r.paExpiration })),
        ...emass90.map((r) => ({ name: r.systemName, source: 'emass', date: r.expirationDate })),
      ]

      for (const item of ninetyDayItems) {
        try {
          await prisma.atoAlert.create({
            data: {
              type: 'expiring_90d',
              title: `${item.name} expires within 90 days`,
              details: JSON.stringify({
                name: item.name,
                expirationDate: item.date,
              }),
              source: item.source,
            },
          })
          alertsCreated++
        } catch (err) {
          console.error('[ATO] Alert creation error (90d):', err)
        }
      }

      summary.alerts = { created: alertsCreated }
    } catch (err) {
      console.error('[ATO] Alert generation failed:', err)
      summary.alerts = { error: err instanceof Error ? err.message : String(err) }
    }

    // ── Step 4: User alert rules (REALTIME + DAILY) ───────────────────
    // Runs after the refresh above so evaluators see today's data. Wrapped so a
    // failure here never fails the sync that already succeeded.
    try {
      summary.userAlerts = await runAlertEngine({ frequencies: ['REALTIME', 'DAILY'] })
    } catch (err) {
      console.error('[alerts] engine failed:', err)
      summary.userAlerts = { error: err instanceof Error ? err.message : String(err) }
    }

    // ── Step 5: Daily digest email ────────────────────────────────────
    try {
      summary.digest = await sendDigests('DAILY')
    } catch (err) {
      console.error('[alerts] daily digest failed:', err)
      summary.digest = { error: err instanceof Error ? err.message : String(err) }
    }

    summary.elapsedMs = Date.now() - RUN_STARTED

    return NextResponse.json({
      message: 'Daily sync complete',
      summary,
    })
  } catch (error) {
    console.error('[ATO] Daily sync cron failed:', error)
    return NextResponse.json(
      { error: 'Daily sync failed' },
      { status: 500 }
    )
  }
}

// Vercel Cron triggers via GET; delegate to POST (auth is checked there).
export async function GET(request: NextRequest) {
  return POST(request)
}
