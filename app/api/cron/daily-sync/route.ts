import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { fetchLatestDcasXlsx, parseDcasWorkbook, syncDisaData } from '@/lib/ingest/disa'
import { requireCronRequest } from '@/lib/admin-auth'

const FEDRAMP_DATA_URL =
  'https://raw.githubusercontent.com/GSA/marketplace-fedramp-gov-data/main/data.json'

export async function POST(request: NextRequest) {
  const cron = requireCronRequest(request)
  if (!cron.ok) return cron.response

  try {
    const summary: Record<string, unknown> = {}

    // ── Step 1: FedRAMP sync from GitHub ──────────────────────────────
    let fedrampAdded = 0
    let fedrampUpdated = 0
    let fedrampFailed = 0

    try {
      console.log('[ATO] Fetching FedRAMP data from GitHub...')
      const response = await fetch(FEDRAMP_DATA_URL)

      if (!response.ok) {
        throw new Error(`FedRAMP fetch failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      const products = data?.data?.Products || data?.Products || []

      console.log(`[ATO] Processing ${products.length} FedRAMP records...`)

      for (const product of products) {
        try {
          const packageId = product.id
          if (!packageId) {
            fedrampFailed++
            continue
          }

          // Normalize status: "FedRAMP Authorized" → "Authorized", etc.
          let status = product.status || 'Unknown'
          if (status.toLowerCase().includes('authorized') && !status.toLowerCase().includes('in process') && !status.toLowerCase().includes('ready')) status = 'Authorized'
          else if (status.toLowerCase().includes('in process')) status = 'InProcess'
          else if (status.toLowerCase().includes('ready')) status = 'Ready'

          // Leveraging agencies
          let leveragingAgencies: string[] = []
          if (Array.isArray(product.agency_authorizations)) {
            leveragingAgencies = product.agency_authorizations.map((a: unknown) => {
              if (typeof a === 'string') return a
              if (a && typeof a === 'object' && 'agency' in (a as Record<string, unknown>)) return (a as { agency: string }).agency
              return String(a)
            }).filter(Boolean)
          }

          const record = {
            packageId: String(packageId),
            csoName: product.cso || product.name || 'Unknown',
            cspName: product.csp || 'Unknown',
            status,
            impactLevel: product.impact_level || null,
            serviceModel: JSON.stringify(
              Array.isArray(product.service_model) ? product.service_model : []
            ),
            deploymentModel: product.deployment_model || null,
            authorizationDate: product.auth_date
              ? new Date(product.auth_date)
              : null,
            expirationDate: product.annual_assessment
              ? new Date(product.annual_assessment)
              : null,
            sponsoringAgency: product.partnering_agency || null,
            leveragingAgencies: JSON.stringify(leveragingAgencies),
            assessorName: product.independent_assessor || null,
            authType: product.auth_type || null,
            serviceDescription: product.service_desc || null,
            website: product.website || null,
            logo: product.logo || null,
            lastSynced: new Date(),
          }

          const existing = await prisma.fedrampAuthorization.findUnique({
            where: { packageId: record.packageId },
          })

          if (existing) {
            await prisma.fedrampAuthorization.update({
              where: { id: existing.id },
              data: record,
            })
            fedrampUpdated++
          } else {
            await prisma.fedrampAuthorization.create({ data: record })
            fedrampAdded++
          }
        } catch (err) {
          fedrampFailed++
          console.error('[ATO] FedRAMP record error:', err)
        }
      }

      // Log FedRAMP sync
      await prisma.atoSyncLog.upsert({
        where: { source: 'fedramp' },
        create: {
          source: 'fedramp',
          lastSyncAt: new Date(),
          recordsAdded: fedrampAdded,
          recordsUpdated: fedrampUpdated,
          recordsFailed: fedrampFailed,
          status: 'success',
        },
        update: {
          lastSyncAt: new Date(),
          recordsAdded: fedrampAdded,
          recordsUpdated: fedrampUpdated,
          recordsFailed: fedrampFailed,
          status: 'success',
        },
      })

      summary.fedramp = { added: fedrampAdded, updated: fedrampUpdated, failed: fedrampFailed }
    } catch (err) {
      console.error('[ATO] FedRAMP sync failed:', err)
      summary.fedramp = { error: err instanceof Error ? err.message : String(err) }

      await prisma.atoSyncLog.upsert({
        where: { source: 'fedramp' },
        create: {
          source: 'fedramp',
          lastSyncAt: new Date(),
          recordsFailed: fedrampFailed,
          status: 'failed',
        },
        update: {
          lastSyncAt: new Date(),
          recordsFailed: fedrampFailed,
          status: 'failed',
        },
      })
    }

    // ── Step 2: DISA DCAS sync (probe dl.dod.cyber.mil) ───────────────
    try {
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
