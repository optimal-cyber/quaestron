import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import { csoDescription, csoSeo, SITE_URL } from '@/lib/seo'
import { daysUntil } from '@/lib/compliance/shared'

/**
 * Per-offering landing page — one indexable URL per FedRAMP authorization.
 *
 * Revalidated daily, matching the ingest cadence. `dynamicParams` is left at its
 * default so an offering added between builds renders on first request rather
 * than 404ing until the next deploy.
 */
export const revalidate = 86400

export async function generateMetadata({
  params,
}: {
  params: Promise<{ packageId: string }>
}): Promise<Metadata> {
  const { packageId } = await params
  const seo = await csoSeo(packageId)
  if (!seo) return { title: 'Authorization — Iron Echelon', robots: { index: false } }

  const title = `${seo.csoName} — FedRAMP ${seo.status}${seo.impactLevel ? ` (${seo.impactLevel})` : ''} | Iron Echelon`
  const description = csoDescription(seo)
  const url = `${SITE_URL}/compliance/cso/${seo.packageId}`

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Iron Echelon', type: 'article' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

function levelClass(level: string | null): string {
  if (!level) return 'text-muted border-border'
  if (level === 'High') return 'text-accent-red border-accent-red/40'
  if (level.includes('Moderate')) return 'text-accent-gold border-accent-gold/40'
  return 'text-accent-blue border-accent-blue/40'
}

export default async function CsoPage({ params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params
  const seo = await csoSeo(packageId)
  if (!seo) notFound()

  const due = daysUntil(seo.expirationDate)

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav />
      <div className="flex-1 pt-12 pb-7 bg-background overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <nav className="font-mono text-[10px] text-muted">
            <Link href="/compliance" className="hover:text-foreground">
              COMPLIANCE
            </Link>
            <span className="mx-2">/</span>
            <span className="text-muted-foreground">{seo.packageId}</span>
          </nav>

          <header className="space-y-3">
            <h1 className="font-mono text-2xl md:text-3xl tracking-[0.06em] text-foreground">
              {seo.csoName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
              <span className={`px-2 py-0.5 rounded border ${levelClass(seo.impactLevel)}`}>
                {seo.impactLevel || 'level unknown'}
              </span>
              <span className="px-2 py-0.5 rounded border border-border text-muted-foreground">
                FedRAMP {seo.status}
              </span>
              {seo.serviceModel.map((m) => (
                <span key={m} className="px-2 py-0.5 rounded bg-surface text-muted">
                  {m}
                </span>
              ))}
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              Offered by{' '}
              {seo.entity ? (
                <Link href={`/vendor/${seo.entity.slug}`} className="text-accent-blue hover:underline">
                  {seo.entity.name}
                </Link>
              ) : (
                <span className="text-foreground">{seo.cspName}</span>
              )}
              {!seo.entity && (
                <span className="text-muted">
                  {' '}
                  — not yet resolved to a tracked vendor, so federal spend cannot be joined
                </span>
              )}
            </p>
          </header>

          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Fact label="Package ID" value={seo.packageId} />
            <Fact
              label="Authorized"
              value={seo.authorizationDate?.toISOString().slice(0, 10) ?? '—'}
            />
            <Fact
              label="Assessment due"
              value={seo.expirationDate?.toISOString().slice(0, 10) ?? '—'}
              note={due !== null && due >= 0 ? `${due} days` : due !== null ? 'overdue' : null}
            />
            <Fact label="Agencies leveraging" value={String(seo.leveragingAgencies.length)} />
          </section>

          <section className="border border-border rounded-lg bg-surface/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-mono text-xs tracking-[0.15em] text-foreground uppercase">
                Agency reuse
              </h2>
            </div>
            <div className="p-4">
              {seo.sponsoringAgency && (
                <p className="font-mono text-[11px] text-muted-foreground mb-3">
                  <span className="text-accent-red">SPONSOR</span> {seo.sponsoringAgency}
                </p>
              )}
              {seo.leveragingAgencies.length === 0 ? (
                <p className="font-mono text-[11px] text-muted">
                  No agencies recorded as leveraging this authorization.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {seo.leveragingAgencies.map((a) => (
                    <span
                      key={a}
                      className="px-2 py-0.5 rounded border border-border font-mono text-[10px] text-muted-foreground"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>

          <p className="font-mono text-[10px] text-muted leading-relaxed">
            Source: FedRAMP Marketplace. The assessment date is the next annual assessment
            due date — FedRAMP authorizations do not hard-expire; they lapse if the
            assessment is unmet.{' '}
            {seo.entity && (
              <>
                See{' '}
                <Link href={`/vendor/${seo.entity.slug}`} className="text-accent-blue hover:underline">
                  {seo.entity.name}&apos;s full compliance posture
                </Link>{' '}
                for its federal contract record.
              </>
            )}
          </p>
        </div>
      </div>
      <BottomBar />
    </div>
  )
}

function Fact({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="border border-border rounded-lg bg-surface/40 p-3">
      <div className="font-mono text-sm text-foreground break-all">{value}</div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted mt-1">{label}</div>
      {note && <div className="font-mono text-[9px] text-accent-gold mt-0.5">{note}</div>}
    </div>
  )
}
