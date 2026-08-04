import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request)
  if (!admin.ok) return admin.response

  try {
    const body = await request.json()
    const { records, importBatchId } = body

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        { error: 'records array is required and must not be empty' },
        { status: 400 }
      )
    }

    let added = 0
    let updated = 0
    let failed = 0
    const errors: string[] = []

    for (const record of records) {
      try {
        if (!record.systemName || !record.component) {
          failed++
          errors.push(`Missing systemName or component for record: ${JSON.stringify(record).slice(0, 100)}`)
          continue
        }

        const existing = await prisma.emassAuthorization.findUnique({
          where: {
            systemName_component: {
              systemName: record.systemName,
              component: record.component,
            },
          },
        })

        const data = {
          systemName: record.systemName,
          systemId: record.systemId || null,
          component: record.component,
          authorizationType: record.authorizationType || 'ATO',
          authorizationDate: record.authorizationDate ? new Date(record.authorizationDate) : null,
          expirationDate: record.expirationDate ? new Date(record.expirationDate) : null,
          impactLevel: record.impactLevel || null,
          authorizingOfficial: record.authorizingOfficial || null,
          issm: record.issm || null,
          isso: record.isso || null,
          systemType: record.systemType || null,
          hostedLocation: record.hostedLocation || null,
          cloudProvider: record.cloudProvider || null,
          source: 'manual',
          importBatchId: importBatchId || null,
          lastSynced: new Date(),
        }

        if (existing) {
          await prisma.emassAuthorization.update({
            where: { id: existing.id },
            data,
          })
          updated++
        } else {
          await prisma.emassAuthorization.create({ data })
          added++
        }
      } catch (err) {
        failed++
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`Failed to upsert ${record.systemName}: ${message}`)
        console.error('[ATO] eMASS import record error:', err)
      }
    }

    // Log sync
    await prisma.atoSyncLog.upsert({
      where: { source: 'emass-manual' },
      create: {
        source: 'emass-manual',
        lastSyncAt: new Date(),
        recordsAdded: added,
        recordsUpdated: updated,
        recordsFailed: failed,
        status: failed > 0 && added === 0 && updated === 0 ? 'failed' : 'success',
      },
      update: {
        lastSyncAt: new Date(),
        recordsAdded: added,
        recordsUpdated: updated,
        recordsFailed: failed,
        status: failed > 0 && added === 0 && updated === 0 ? 'failed' : 'success',
      },
    })

    return NextResponse.json({ added, updated, failed, errors })
  } catch (error) {
    console.error('[ATO] Error importing eMASS data:', error)
    return NextResponse.json(
      { error: 'Failed to import eMASS data' },
      { status: 500 }
    )
  }
}
