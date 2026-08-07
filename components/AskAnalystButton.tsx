'use client'

import Link from 'next/link'

/**
 * Deep-link into the analyst with a thread pre-seeded for one vendor.
 *
 * The `entity` param becomes the thread's `entitySlug`, which the server turns
 * into a context line appended to the system prompt — so the model knows which
 * vendor "it" refers to without the user restating it.
 */
export default function AskAnalystButton({
  slug,
  name,
  question,
  compact = false,
}: {
  slug: string
  name?: string
  question?: string
  compact?: boolean
}) {
  const params = new URLSearchParams({ entity: slug })
  params.set(
    'q',
    question ?? `Give me a compliance and federal-spend read on ${name || slug}.`
  )

  const size = compact ? 'px-2 py-1 text-[12px]' : 'px-3 py-1.5 text-xs'

  return (
    <Link
      href={`/analyst?${params}`}
      className={`${size} inline-flex items-center font-mono tracking-wider rounded border border-accent-gold/40 text-accent-gold hover:bg-accent-gold/10 transition-colors`}
      title="Open the AI analyst with this vendor pre-loaded"
    >
      ASK THE ANALYST
    </Link>
  )
}
