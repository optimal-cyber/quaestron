import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import WatchlistsClient from './WatchlistsClient'

export const metadata: Metadata = {
  title: 'Watchlists — Quaestron',
  robots: { index: false, follow: false },
}

export default async function WatchlistsPage() {
  const user = await requireUser('/watchlists')

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav />
      <div className="flex-1 pt-12 pb-7 bg-background overflow-y-auto">
        <WatchlistsClient tier={user.tier} />
      </div>
      <BottomBar />
    </div>
  )
}
