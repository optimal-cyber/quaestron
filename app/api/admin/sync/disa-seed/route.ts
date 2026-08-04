import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'

const SEED_DATA: Array<{ csoName: string; cspName: string; impactLevel: string }> = [
  // AWS GovCloud
  { csoName: 'AWS GovCloud', cspName: 'Amazon Web Services', impactLevel: 'IL2' },
  { csoName: 'AWS GovCloud', cspName: 'Amazon Web Services', impactLevel: 'IL4' },
  { csoName: 'AWS GovCloud', cspName: 'Amazon Web Services', impactLevel: 'IL5' },
  // Microsoft Azure Government
  { csoName: 'Microsoft Azure Government', cspName: 'Microsoft', impactLevel: 'IL2' },
  { csoName: 'Microsoft Azure Government', cspName: 'Microsoft', impactLevel: 'IL4' },
  { csoName: 'Microsoft Azure Government', cspName: 'Microsoft', impactLevel: 'IL5' },
  { csoName: 'Microsoft Azure Government', cspName: 'Microsoft', impactLevel: 'IL6' },
  // Google Cloud
  { csoName: 'Google Cloud', cspName: 'Google', impactLevel: 'IL2' },
  { csoName: 'Google Cloud', cspName: 'Google', impactLevel: 'IL4' },
  { csoName: 'Google Cloud', cspName: 'Google', impactLevel: 'IL5' },
  // Oracle Cloud Infrastructure
  { csoName: 'Oracle Cloud Infrastructure', cspName: 'Oracle', impactLevel: 'IL2' },
  { csoName: 'Oracle Cloud Infrastructure', cspName: 'Oracle', impactLevel: 'IL4' },
  { csoName: 'Oracle Cloud Infrastructure', cspName: 'Oracle', impactLevel: 'IL5' },
  // Microsoft 365 GCC High
  { csoName: 'Microsoft 365 GCC High', cspName: 'Microsoft', impactLevel: 'IL5' },
  // Salesforce Government Cloud
  { csoName: 'Salesforce Government Cloud', cspName: 'Salesforce', impactLevel: 'IL4' },
  // ServiceNow GovCloud
  { csoName: 'ServiceNow GovCloud', cspName: 'ServiceNow', impactLevel: 'IL4' },
  { csoName: 'ServiceNow GovCloud', cspName: 'ServiceNow', impactLevel: 'IL5' },
  // Palantir
  { csoName: 'Palantir', cspName: 'Palantir Technologies', impactLevel: 'IL5' },
  // Second Front Game Warden
  { csoName: 'Game Warden', cspName: 'Second Front Systems', impactLevel: 'IL5' },
]

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request)
  if (!admin.ok) return admin.response

  try {
    let added = 0
    let updated = 0
    let failed = 0

    for (const record of SEED_DATA) {
      try {
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
          source: 'seed',
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
        console.error(`[ATO] Failed to seed ${record.csoName} ${record.impactLevel}:`, err)
      }
    }

    // Log sync
    await prisma.atoSyncLog.upsert({
      where: { source: 'disa-seed' },
      create: {
        source: 'disa-seed',
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

    return NextResponse.json({
      message: 'DISA PA seed complete',
      total: SEED_DATA.length,
      added,
      updated,
      failed,
    })
  } catch (error) {
    console.error('[ATO] Error seeding DISA PA data:', error)
    return NextResponse.json(
      { error: 'Failed to seed DISA PA data' },
      { status: 500 }
    )
  }
}
