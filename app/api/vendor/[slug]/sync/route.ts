import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { syncVendor } from '@/lib/vendor/sync-vendor'
import { requireAdminRequest } from '@/lib/admin-auth'

export const maxDuration = 60

/**
 * Explicit vendor refresh trigger. The dossier aggregator builds unknown
 * vendors in-process; this endpoint is for a manual "refresh" or an operator
 * re-sync. Guarded by SYNC_API_KEY (skipped when unset, for local dev).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const admin = await requireAdminRequest(request)
  if (!admin.ok) return admin.response

  const { slug } = await params
  const sp = request.nextUrl.searchParams
  const force = sp.get('force') === '1' || sp.get('force') === 'true'
  const uei = sp.get('uei') || undefined
  let name = sp.get('name') || undefined

  // If the slug matches an existing entity, resolve its canonical name.
  if (!name && !uei) {
    const entity = await prisma.entity.findFirst({
      where: { OR: [{ slug }, { id: slug }] },
      select: { name: true, uei: true },
    })
    if (entity) name = entity.name
  }

  if (!name && !uei) {
    return NextResponse.json(
      { error: 'Provide ?name= or ?uei=, or use a slug that matches an existing entity' },
      { status: 400 }
    )
  }

  try {
    const result = await syncVendor({ name, uei, force })
    return NextResponse.json({
      success: true,
      slug: result.entity.slug,
      created: result.created,
      skipped: result.skipped,
      counts: result.counts,
      riskFlags: result.riskFlags,
      errors: result.errors,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
