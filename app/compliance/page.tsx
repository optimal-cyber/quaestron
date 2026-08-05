import type { Metadata } from 'next'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import ComplianceClient from './ComplianceClient'

export const metadata: Metadata = {
  title: 'Compliance Intelligence — Quaestron',
  description:
    'Every FedRAMP authorization and DoD provisional authorization joined to federal contract history. Filter the authorized-cloud universe by impact level, agency, set-aside, and assessment due date.',
  openGraph: {
    title: 'Compliance Intelligence — Quaestron',
    description:
      'The authorized-cloud universe: who is cleared to operate, at what impact level, for which agency, and whether they are winning work there.',
  },
}

export default function CompliancePage() {
  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav />
      <div className="flex-1 pt-12 pb-7 bg-background overflow-y-auto">
        <ComplianceClient />
      </div>
      <BottomBar />
    </div>
  )
}
