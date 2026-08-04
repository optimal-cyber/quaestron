import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import AlertsClient from './AlertsClient'

export const metadata: Metadata = {
  title: 'Alerts — Iron Echelon',
  robots: { index: false, follow: false },
}

export default async function AlertsPage() {
  await requireUser('/alerts')

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav />
      <div className="flex-1 pt-12 pb-7 bg-background overflow-y-auto">
        <AlertsClient />
      </div>
      <BottomBar />
    </div>
  )
}
