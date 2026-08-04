import { NextRequest, NextResponse } from 'next/server'
import { loadFromFile, fetchFromGitHub, syncFedrampData, type MappedProduct } from '@/lib/ingest/fedramp'
import { requireAdminRequest } from '@/lib/admin-auth'

const LOG_PREFIX = '[ATO-SYNC]'

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request)
  if (!admin.ok) return admin.response

  try {
    let body: { filePath?: string; records?: unknown[] } = {}
    try {
      body = await request.json()
    } catch {
      // No body or invalid JSON — that's fine, we'll use GitHub
    }

    let data: MappedProduct[]
    let sourceLabel: string

    if (body.records && Array.isArray(body.records)) {
      // Direct JSON upload (e.g., from admin panel pasting ATO export data)
      console.log(`${LOG_PREFIX} Admin sync triggered with ${body.records.length} inline records`)
      const { loadFromRecords } = await import('@/lib/ingest/fedramp')
      const result = loadFromRecords(body.records)
      data = result.data
      sourceLabel = result.sourceLabel
    } else if (body.filePath) {
      console.log(`${LOG_PREFIX} Admin sync triggered with file: ${body.filePath}`)
      const result = await loadFromFile(body.filePath)
      data = result.data
      sourceLabel = result.sourceLabel
    } else {
      console.log(`${LOG_PREFIX} Admin sync triggered — fetching from GitHub`)
      const result = await fetchFromGitHub()
      data = result.data
      sourceLabel = result.sourceLabel
    }

    const summary = await syncFedrampData(data)

    return NextResponse.json({
      success: true,
      source: sourceLabel,
      ...summary,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${LOG_PREFIX} Sync failed:`, message)
    return NextResponse.json({ error: 'Sync failed', message }, { status: 500 })
  }
}
