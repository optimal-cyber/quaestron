import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import AccountClient from './AccountClient'

export const metadata: Metadata = {
  title: 'Account — Iron Echelon',
  robots: { index: false, follow: false },
}

export default async function AccountPage() {
  const user = await requireUser('/account')

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav />
      <div className="flex-1 pt-12 pb-7 bg-background overflow-y-auto">
        <AccountClient
          email={user.email}
          tier={user.tier}
          role={user.role}
          initialOptIn={user.alertEmailOptIn}
        />
      </div>
      <BottomBar />
    </div>
  )
}
