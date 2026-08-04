import { NextRequest, NextResponse } from 'next/server'
import {
  fetchDcasFromUrl,
  fetchLatestDcasXlsx,
  loadDcasFromFile,
  parseDcasWorkbook,
  syncDisaData,
} from '@/lib/ingest/disa'
import { requireAdminRequest } from '@/lib/admin-auth'

const LOG_PREFIX = '[DISA-SYNC]'

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request)
  if (!admin.ok) return admin.response

  try {
    let body: { url?: string; filePath?: string; daysBack?: number } = {}
    try {
      body = await request.json()
    } catch {
      // No body — fall through to probe
    }

    let buffer: Buffer
    let sourceLabel: string

    if (body.filePath) {
      console.log(`${LOG_PREFIX} Admin sync triggered with file: ${body.filePath}`)
      buffer = await loadDcasFromFile(body.filePath)
      sourceLabel = `file:${body.filePath}`
    } else if (body.url) {
      console.log(`${LOG_PREFIX} Admin sync triggered with url: ${body.url}`)
      const result = await fetchDcasFromUrl(body.url)
      buffer = result.buffer
      sourceLabel = `url:${result.url}`
    } else {
      console.log(`${LOG_PREFIX} Admin sync triggered — probing dl.dod.cyber.mil`)
      const result = await fetchLatestDcasXlsx({ daysBack: body.daysBack })
      buffer = result.buffer
      sourceLabel = `probe:${result.url}`
    }

    const records = parseDcasWorkbook(buffer)
    const summary = await syncDisaData(records)

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
