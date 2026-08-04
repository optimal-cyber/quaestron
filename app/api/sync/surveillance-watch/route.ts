import { NextRequest, NextResponse } from 'next/server'
import { runFullSync } from '@/lib/sync/sync-entities'
import { requireCronRequest } from '@/lib/admin-auth'

// Allow GET for cron job triggers (e.g., Vercel Cron, external cron services).
// Secured by CRON_SECRET (open only in local dev, when the var is unset).
export async function GET(request: NextRequest) {
  const cron = requireCronRequest(request)
  if (!cron.ok) return cron.response

  try {
    const result = await runFullSync()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[SYNC] Error:', error)
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

// POST for manual triggers from the UI
export async function POST() {
  try {
    const result = await runFullSync()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[SYNC] Error:', error)
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
