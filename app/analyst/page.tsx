import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { analystConfigured, analystModel } from '@/lib/ai/analyst'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import AnalystClient from './AnalystClient'

export const metadata: Metadata = {
  title: 'Analyst — Quaestron',
  robots: { index: false, follow: false },
}

/**
 * The analyst is available to every signed-in user; the Free tier is metered to
 * 5 messages a day rather than blocked outright, so the capability is
 * demonstrable before anyone subscribes.
 */
export default async function AnalystPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; entity?: string; q?: string }>
}) {
  const user = await requireUser('/analyst')
  const { thread, entity, q } = await searchParams

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav />
      <div className="flex-1 pt-12 pb-7 bg-background overflow-hidden">
        <AnalystClient
          tier={user.tier}
          configured={analystConfigured()}
          model={analystConfigured() ? analystModel() : null}
          initialThreadId={thread ?? null}
          seededEntity={entity ?? null}
          seededPrompt={q ?? null}
        />
      </div>
      <BottomBar />
    </div>
  )
}
