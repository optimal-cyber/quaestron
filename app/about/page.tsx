import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'

export default function AboutPage() {
  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav />

      <div className="flex-1 pt-12 pb-7 bg-background overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 md:py-12">
          <h1 className="font-mono text-2xl tracking-[0.15em] text-foreground mb-2">
            ABOUT QUAESTRON
          </h1>
          <div className="w-12 h-0.5 bg-accent-red mb-8" />

          <section className="mb-10">
            <h2 className="font-mono text-sm tracking-[0.15em] text-accent-red mb-4">MISSION</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Quaestron maps the defense technology, cybersecurity, AI, and surveillance ecosystem.
              We track the companies, investors, government agencies, contracts, and relationships that
              define the modern national security landscape.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="font-mono text-sm tracking-[0.15em] text-accent-red mb-4">METHODOLOGY</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Our data is sourced from public records, government databases, SEC filings, and open-source
              intelligence. Every connection between entities is scored for confidence:
            </p>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <span className="font-mono text-xs text-accent-green bg-accent-green/10 px-2 py-0.5 rounded shrink-0">
                  CONFIRMED
                </span>
                <span className="text-sm text-muted-foreground">
                  Verified through official records — government contracts, SEC filings, corporate disclosures.
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="font-mono text-xs text-accent-gold bg-accent-gold/10 px-2 py-0.5 rounded shrink-0">
                  REPORTED
                </span>
                <span className="text-sm text-muted-foreground">
                  Based on credible news reporting from established defense and security publications.
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="font-mono text-xs text-accent-blue bg-accent-blue/10 px-2 py-0.5 rounded shrink-0">
                  INFERRED
                </span>
                <span className="text-sm text-muted-foreground">
                  Derived from organizational overlap, SEC filings analysis, or pattern analysis.
                </span>
              </div>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="font-mono text-sm tracking-[0.15em] text-accent-red mb-4">DATA SOURCES</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-accent-blue shrink-0" />
                Surveillance Watch (surveillancewatch.io)
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-accent-blue shrink-0" />
                USAspending.gov — Federal contract awards
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-accent-blue shrink-0" />
                SEC EDGAR — Public company filings
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-accent-blue shrink-0" />
                SAM.gov — Contractor registration data
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-accent-blue shrink-0" />
                Defense & cybersecurity news publications
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-mono text-sm tracking-[0.15em] text-accent-red mb-4">CONTACT</h2>
            <p className="text-sm text-muted-foreground">
              Quaestron is part of the Iron Echelon newsletter — defense tech intelligence for practitioners.
            </p>
          </section>
        </div>
      </div>

      <BottomBar />
    </div>
  )
}
