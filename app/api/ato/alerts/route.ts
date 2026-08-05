import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'

/**
 * ATO alert feed.
 *
 * The PUT was unauthenticated: it took an `id` from the body and set
 * `acknowledged: true` on any AtoAlert. Anyone could walk the GET feed, PUT
 * every id back, and empty the alert list. That is worse than a destructive
 * write, because nothing looks broken afterwards — an operator sees a clean
 * board and concludes there is nothing expiring.
 *
 * AtoAlert carries no userId; these are system-wide alerts, not per-user rows,
 * so there is no owner to check against. The correct guard is therefore admin,
 * not ownership. Nothing in the app calls this PUT today — the acknowledge flow
 * lives in /admin — so restricting it breaks no caller.
 */

const AcknowledgeSchema = z.object({
  id: z.string().uuid(),
})

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const type = sp.get('type')

    const where: Record<string, unknown> = {
      acknowledged: false,
    }

    if (type) {
      where.type = type
    }

    const alerts = await prisma.atoAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ alerts, total: alerts.length })
  } catch (error) {
    console.error('[ATO] Error fetching alerts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch alerts' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminRequest(request)
  if (!auth.ok) return auth.response

  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = AcknowledgeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Alert id is required' }, { status: 400 })
    }

    const alert = await prisma.atoAlert.update({
      where: { id: parsed.data.id },
      data: { acknowledged: true },
    })

    return NextResponse.json({ alert })
  } catch (error) {
    console.error('[ATO] Error acknowledging alert:', error)
    return NextResponse.json(
      { error: 'Failed to acknowledge alert' },
      { status: 500 }
    )
  }
}
