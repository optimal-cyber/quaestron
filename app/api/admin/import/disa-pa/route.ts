import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request)
  if (!admin.ok) return admin.response

  try {
    const body = await request.json()
    const { records } = body

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
        if (!record.csoName || !record.cspName || !record.impactLevel) {
          failed++
          errors.push(`Missing csoName, cspName, or impactLevel for record: ${JSON.stringify(record).slice(0, 100)}`)
          continue
        }

        const existing = await prisma.dodProvisionalAuth.findUnique({
          where: {
            csoName_cspName_impactLevel: {
              csoName: record.csoName,
              cspName: record.cspName,
              impactLevel: record.impactLevel,
            },
          },
        })

        const data = {
          csoName: record.csoName,
          cspName: record.cspName,
          impactLevel: record.impactLevel,
          paDate: record.paDate ? new Date(record.paDate) : null,
          paExpiration: record.paExpiration ? new Date(record.paExpiration) : null,
          sponsorComponent: record.sponsorComponent || null,
          conditions: record.conditions || null,
          source: 'manual',
          lastSynced: new Date(),
        }

        if (existing) {
          await prisma.dodProvisionalAuth.update({
            where: { id: existing.id },
            data,
          })
          updated++
        } else {
          await prisma.dodProvisionalAuth.create({ data })
          added++
        }
      } catch (err) {
        failed++
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`Failed to upsert ${record.csoName}: ${message}`)
        console.error('[ATO] DISA PA import record error:', err)
      }
    }

    // Log sync
    await prisma.atoSyncLog.upsert({
      where: { source: 'disa-pa-manual' },
      create: {
        source: 'disa-pa-manual',
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
    console.error('[ATO] Error importing DISA PA data:', error)
    return NextResponse.json(
      { error: 'Failed to import DISA PA data' },
      { status: 500 }
    )
  }
}
