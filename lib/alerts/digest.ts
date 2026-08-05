import { prisma } from '@/lib/db'
import { limitsFor, type Frequency } from './types'
import { emailConfigured, sendDigest, type DigestEvent } from './email'
import type { Tier } from '@/lib/auth'

/**
 * Batches un-emailed alert events into one digest per user and sends it.
 *
 * Tier is re-checked here, not just at rule-creation time: a user who downgrades
 * from PRO shouldn't keep receiving daily mail from rules created while they
 * were paying.
 */

export interface DigestResult {
  usersConsidered: number
  digestsSent: number
  eventsEmailed: number
  skipped: string[]
  errors: string[]
}

const MAX_EVENTS_PER_DIGEST = 40
const MAX_USERS_PER_RUN = 200

export async function sendDigests(cadence: 'DAILY' | 'WEEKLY'): Promise<DigestResult> {
  const result: DigestResult = {
    usersConsidered: 0,
    digestsSent: 0,
    eventsEmailed: 0,
    skipped: [],
    errors: [],
  }

  if (!emailConfigured()) {
    result.skipped.push('RESEND_API_KEY not configured — no digests sent')
    return result
  }

  const siteUrl = (process.env.AUTH_URL || 'https://quaestron.io').replace(/\/$/, '')

  // Un-emailed events from EMAIL-channel rules at this cadence. IN_APP rules
  // deliberately produce inbox entries only.
  const pending = await prisma.alertEvent.findMany({
    where: {
      emailedAt: null,
      rule: { channel: 'EMAIL', frequency: cadence, active: true },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      userId: true,
      ruleType: true,
      title: true,
      body: true,
      url: true,
      createdAt: true,
      user: { select: { email: true, tier: true, alertEmailOptIn: true } },
    },
    take: MAX_EVENTS_PER_DIGEST * MAX_USERS_PER_RUN,
  })

  if (pending.length === 0) return result

  const byUser = new Map<string, typeof pending>()
  for (const event of pending) {
    const list = byUser.get(event.userId)
    if (list) list.push(event)
    else byUser.set(event.userId, [event])
  }

  result.usersConsidered = byUser.size

  for (const [userId, events] of byUser) {
    const user = events[0].user
    const allEventIds = events.map((e) => e.id)

    if (!user.email) {
      result.skipped.push(`${userId}: no email address`)
      continue
    }
    if (!user.alertEmailOptIn) {
      // Opted out — mark handled so these don't accumulate forever. The events
      // remain in the in-app inbox.
      await markEmailed(allEventIds)
      result.skipped.push(`${user.email}: opted out of alert email`)
      continue
    }

    const allowed = limitsFor((user.tier as Tier) || 'FREE').frequencies
    if (!allowed.includes(cadence as Frequency)) {
      result.skipped.push(`${user.email}: ${cadence} digest not available on ${user.tier}`)
      continue
    }

    const batch = events.slice(0, MAX_EVENTS_PER_DIGEST)
    const payload = {
      to: user.email,
      cadence,
      siteUrl,
      events: batch.map(
        (e): DigestEvent => ({
          id: e.id,
          ruleType: e.ruleType,
          title: e.title,
          body: e.body,
          url: e.url,
          createdAt: e.createdAt,
        })
      ),
    }

    const sent = await sendDigest(payload)

    if (sent.sent) {
      // Only the batch that actually shipped is marked; any overflow rides
      // along in the next digest rather than being silently dropped.
      await markEmailed(batch.map((e) => e.id))
      result.digestsSent++
      result.eventsEmailed += batch.length
    } else if (sent.error) {
      result.errors.push(`${user.email}: ${sent.error}`)
    } else if (sent.skipped) {
      result.skipped.push(`${user.email}: ${sent.skipped}`)
    }
  }

  return result
}

async function markEmailed(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await prisma.alertEvent.updateMany({
    where: { id: { in: ids } },
    data: { emailedAt: new Date() },
  })
}
