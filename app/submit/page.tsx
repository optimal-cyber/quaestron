'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import SearchCommand from '@/components/layout/SearchCommand'
import { useAppStore } from '@/lib/store'

const ENTITY_TYPES = [
  { value: 'DEFENSE_PRIME', label: 'Defense Prime Contractor' },
  { value: 'CYBER_INTEL', label: 'Cyber / Intelligence' },
  { value: 'SURVEILLANCE', label: 'Surveillance Technology' },
  { value: 'AI_ML', label: 'AI / Machine Learning' },
  { value: 'INVESTOR', label: 'Investor / Funder' },
  { value: 'GOVERNMENT', label: 'Government Agency' },
  { value: 'CLOUD_INFRA', label: 'Cloud / Infrastructure' },
  { value: 'STARTUP', label: 'Startup' },
  { value: 'CONSULTANCY', label: 'Consultancy / Advisory' },
]

export default function SubmitPage() {
  const { setSearchOpen } = useAppStore()
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    submitterEmail: '',
    entityName: '',
    entityType: '',
    website: '',
    headquartersCountry: '',
    description: '',
    connectionInfo: '',
    sourceUrl1: '',
    sourceUrl2: '',
    sourceUrl3: '',
    // Honeypot: rendered off-screen and hidden from assistive tech, never
    // filled by a human. Any value means a bot walked the DOM.
    company_website: '',
  })

  const update = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.entityName || !form.entityType || !form.description) {
      setError('Entity name, type, and description are required.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const sourceUrls = [form.sourceUrl1, form.sourceUrl2, form.sourceUrl3].filter(Boolean)
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submitterEmail: form.submitterEmail,
          entityName: form.entityName,
          entityType: form.entityType,
          website: form.website,
          headquartersCountry: form.headquartersCountry,
          description: form.description,
          connectionInfo: form.connectionInfo,
          sourceUrls,
          // Honeypot — always empty for a real user. See app/api/submissions.
          company_website: form.company_website,
        }),
      })

      const data = await res.json()
      if (data.success) {
        setSubmitted(true)
      } else {
        setError(data.error || 'Submission failed.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav onSearchOpen={() => setSearchOpen(true)} />
      <SearchCommand />

      <div className="flex-1 pt-12 pb-7 overflow-y-auto bg-background">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-10">
          {/* Header */}
          <div className="mb-8">
            <div className="font-mono text-[10px] tracking-[0.3em] text-accent-red mb-2">CROWDSOURCED INTELLIGENCE</div>
            <h1 className="font-mono text-2xl tracking-[0.1em] text-foreground mb-2">SUBMIT INTEL</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Know of a defense technology company, surveillance vendor, investor, or government contract
              that should be tracked? Submit it here. All submissions are reviewed before being added
              to the database.
            </p>
          </div>

          {submitted ? (
            <div className="bg-surface border border-accent-green/30 rounded-lg p-8 text-center">
              <div className="font-mono text-accent-green text-sm tracking-[0.2em] mb-3">SUBMISSION RECEIVED</div>
              <p className="text-sm text-muted-foreground mb-6">
                Your intel has been queued for review. If approved, it will appear in the database
                within 48 hours.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => { setSubmitted(false); setForm({ submitterEmail: '', entityName: '', entityType: '', website: '', headquartersCountry: '', description: '', connectionInfo: '', sourceUrl1: '', sourceUrl2: '', sourceUrl3: '', company_website: '' }) }}
                  className="px-4 py-2 bg-surface border border-border rounded font-mono text-xs tracking-wider text-foreground hover:bg-surface-hover transition-colors"
                >
                  SUBMIT ANOTHER
                </button>
                <button
                  onClick={() => router.push('/map')}
                  className="px-4 py-2 bg-accent-red/10 border border-accent-red/30 rounded font-mono text-xs tracking-wider text-accent-red hover:bg-accent-red/20 transition-colors"
                >
                  EXPLORE MAP
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/*
                Honeypot. Positioned off-screen rather than `display: none`,
                which some bots check for; aria-hidden and tabIndex -1 keep it
                out of the path of anyone using a screen reader or keyboard.
              */}
              <input
                type="text"
                name="company_website"
                value={form.company_website}
                onChange={(e) => update('company_website', e.target.value)}
                className="absolute left-[-9999px] w-px h-px"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />
              {/* Entity Name */}
              <div>
                <label className="block font-mono text-[10px] tracking-[0.2em] text-muted mb-2">
                  ENTITY NAME <span className="text-accent-red">*</span>
                </label>
                <input
                  type="text"
                  value={form.entityName}
                  onChange={(e) => update('entityName', e.target.value)}
                  placeholder="e.g. Palantir Technologies"
                  className="w-full bg-surface border border-border rounded px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50 transition-colors"
                />
              </div>

              {/* Type */}
              <div>
                <label className="block font-mono text-[10px] tracking-[0.2em] text-muted mb-2">
                  ENTITY TYPE <span className="text-accent-red">*</span>
                </label>
                <select
                  value={form.entityType}
                  onChange={(e) => update('entityType', e.target.value)}
                  className="w-full bg-surface border border-border rounded px-4 py-3 font-mono text-sm text-foreground focus:outline-none focus:border-accent-red/50 transition-colors appearance-none"
                >
                  <option value="">Select type...</option>
                  {ENTITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Two columns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-[10px] tracking-[0.2em] text-muted mb-2">WEBSITE</label>
                  <input
                    type="url"
                    value={form.website}
                    onChange={(e) => update('website', e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-surface border border-border rounded px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[10px] tracking-[0.2em] text-muted mb-2">HEADQUARTERS COUNTRY</label>
                  <input
                    type="text"
                    value={form.headquartersCountry}
                    onChange={(e) => update('headquartersCountry', e.target.value)}
                    placeholder="e.g. United States"
                    className="w-full bg-surface border border-border rounded px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50 transition-colors"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block font-mono text-[10px] tracking-[0.2em] text-muted mb-2">
                  DESCRIPTION <span className="text-accent-red">*</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  placeholder="What does this entity do? What products/services do they provide in the defense/surveillance space?"
                  rows={4}
                  className="w-full bg-surface border border-border rounded px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50 transition-colors resize-none"
                />
              </div>

              {/* Connection Info */}
              <div>
                <label className="block font-mono text-[10px] tracking-[0.2em] text-muted mb-2">
                  KNOWN CONNECTIONS / FUNDING
                </label>
                <textarea
                  value={form.connectionInfo}
                  onChange={(e) => update('connectionInfo', e.target.value)}
                  placeholder="Any known investors, parent companies, government contracts, partnerships, or subsidiaries?"
                  rows={3}
                  className="w-full bg-surface border border-border rounded px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50 transition-colors resize-none"
                />
              </div>

              {/* Source URLs */}
              <div>
                <label className="block font-mono text-[10px] tracking-[0.2em] text-muted mb-2">
                  SOURCE URLS
                </label>
                <div className="space-y-2">
                  {(['sourceUrl1', 'sourceUrl2', 'sourceUrl3'] as const).map((field, i) => (
                    <input
                      key={field}
                      type="url"
                      value={form[field]}
                      onChange={(e) => update(field, e.target.value)}
                      placeholder={`Source ${i + 1} URL`}
                      className="w-full bg-surface border border-border rounded px-4 py-2.5 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50 transition-colors"
                    />
                  ))}
                </div>
                <p className="text-[10px] text-muted mt-1 font-mono">
                  News articles, official filings, or reports that document this entity.
                </p>
              </div>

              {/* Email */}
              <div>
                <label className="block font-mono text-[10px] tracking-[0.2em] text-muted mb-2">
                  YOUR EMAIL <span className="text-muted">(OPTIONAL)</span>
                </label>
                <input
                  type="email"
                  value={form.submitterEmail}
                  onChange={(e) => update('submitterEmail', e.target.value)}
                  placeholder="For follow-up if needed"
                  className="w-full bg-surface border border-border rounded px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent-red/50 transition-colors"
                />
                <p className="text-[10px] text-muted mt-1 font-mono">
                  Never shared publicly. Only used if we need clarification.
                </p>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-accent-red/10 border border-accent-red/30 rounded px-4 py-3 font-mono text-xs text-accent-red">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-accent-red/10 border border-accent-red/40 rounded font-mono text-sm tracking-[0.15em] text-accent-red hover:bg-accent-red/20 hover:border-accent-red/60 transition-all disabled:opacity-50"
              >
                {submitting ? 'TRANSMITTING...' : 'SUBMIT INTEL'}
              </button>
            </form>
          )}
        </div>
      </div>

      <BottomBar />
    </div>
  )
}
