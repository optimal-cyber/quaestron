import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { normalizeApolloOrg, type ApolloFunding } from '@/lib/clients/apollo'
import { persistApolloFunding } from '@/lib/vendor/funding-apollo'
import { requireAdminRequest } from '@/lib/admin-auth'

/**
 * Ingest Apollo.io enrichment for one vendor. Because the Apollo MCP tool is
 * session-bound (the deployed app can't call it), an operator — or Claude via
 * the MCP tool, after the required per-run 1-credit confirmation — POSTs the
 * enrichment payload here.
 *
 * Accepts either:
 *   { "organization": { ...raw Apollo org... } }   (normalized here), or
 *   { "totalFunding", "rounds", ... }              (already-normalized ApolloFunding)
 *
 * Guarded by SYNC_API_KEY (skipped when unset, for local dev). Idempotent.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const admin = await requireAdminRequest(request)
  if (!admin.ok) return admin.response

  const { slug } = await params
  const entity = await prisma.entity.findFirst({
    where: { OR: [{ slug }, { id: slug }] },
    select: { id: true, name: true },
  })
  if (!entity) {
    return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let funding: ApolloFunding
  if (body.organization && typeof body.organization === 'object') {
    funding = normalizeApolloOrg(body.organization as Parameters<typeof normalizeApolloOrg>[0])
  } else if ('totalFunding' in body || 'rounds' in body) {
    funding = {
      totalFunding: (body.totalFunding as number) ?? null,
      latestRoundStage: (body.latestRoundStage as string) ?? null,
      latestRoundDate: (body.latestRoundDate as string) ?? null,
      employees: (body.employees as number) ?? null,
      annualRevenue: (body.annualRevenue as number) ?? null,
      foundedYear: (body.foundedYear as number) ?? null,
      rounds: Array.isArray(body.rounds) ? (body.rounds as ApolloFunding['rounds']) : [],
    }
  } else {
    return NextResponse.json(
      { error: 'Body must contain an Apollo "organization" object or normalized funding fields' },
      { status: 400 }
    )
  }

  const rows = await persistApolloFunding(entity.id, funding)
  return NextResponse.json({ success: true, vendor: entity.name, roundsWritten: rows, funding })
}
