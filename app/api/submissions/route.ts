import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdminRequest } from '@/lib/admin-auth'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Public entity submissions.
 *
 * POST stays unauthenticated on purpose — anyone can suggest an entity — so the
 * spam controls are the only thing between this table and a script: a schema
 * with real bounds, a per-IP hourly limit, and a honeypot.
 *
 * GET is not public and never should have been. It returned the 50 most recent
 * submissions *including submitterEmail* to any caller: the addresses of people
 * who volunteered information about defense vendors, which is precisely the set
 * of people with a reason not to be enumerable.
 *
 * The POST response keeps its original top-level `{ success, id }` / `{ error }`
 * shape rather than moving to the `{ data, error }` envelope, because
 * app/submit/page.tsx reads `data.success` directly.
 */

const ENTITY_TYPES = [
  'DEFENSE_PRIME',
  'CYBER_INTEL',
  'SURVEILLANCE',
  'AI_ML',
  'INVESTOR',
  'GOVERNMENT',
  'CLOUD_INFRA',
  'STARTUP',
  'CONSULTANCY',
] as const

/** Optional free text: absent, empty string, or bounded content. */
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))

const SubmissionSchema = z.object({
  entityName: z.string().trim().min(2).max(200),
  entityType: z.enum(ENTITY_TYPES),
  description: z.string().trim().min(10).max(5_000),
  submitterEmail: z.string().trim().email().max(320).optional().or(z.literal('')),
  website: z.string().trim().url().max(500).optional().or(z.literal('')),
  headquartersCountry: optionalText(100),
  connectionInfo: optionalText(5_000),
  sourceUrls: z.array(z.string().trim().url().max(500)).max(10).optional(),
  /**
   * Honeypot. The form renders this off-screen with autocomplete off and never
   * fills it, so a human cannot type into it. Anything non-empty is a bot.
   */
  company_website: z.string().max(0).optional(),
})

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, RATE_LIMITS.submissions)
  if (limited.response) return limited.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: limited.headers })
  }

  const parsed = SubmissionSchema.safeParse(body)
  if (!parsed.success) {
    // Honeypot tripped: return the same success shape a real submission gets,
    // so the bot has no signal to tune against and no reason to retry.
    if (parsed.error.issues.some((i) => i.path[0] === 'company_website')) {
      return NextResponse.json({ success: true, id: null }, { headers: limited.headers })
    }
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400, headers: limited.headers }
    )
  }

  const input = parsed.data

  try {
    const submission = await prisma.submission.create({
      data: {
        submitterEmail: input.submitterEmail || null,
        entityName: input.entityName,
        entityType: input.entityType,
        website: input.website || null,
        headquartersCountry: input.headquartersCountry || null,
        description: input.description,
        connectionInfo: input.connectionInfo || null,
        sourceUrls: JSON.stringify(input.sourceUrls ?? []),
      },
      select: { id: true },
    })

    return NextResponse.json({ success: true, id: submission.id }, { headers: limited.headers })
  } catch (error) {
    console.error('[SUBMISSION] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create submission' },
      { status: 500, headers: limited.headers }
    )
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminRequest(request)
  if (!auth.ok) return auth.response

  const submissions = await prisma.submission.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json({ submissions })
}
