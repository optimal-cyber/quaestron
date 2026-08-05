import { z } from 'zod'
import { prisma } from '@/lib/db'
import { apiRequireUser } from '@/lib/auth'
import { fail, parseBody } from '@/lib/api/response'
import {
  analystConfigured,
  deriveTitle,
  runAnalystTurn,
  toMessageHistory,
} from '@/lib/ai/analyst'
import { entityContextLine } from '@/lib/ai/tools'
import { checkAnalystQuota } from '@/lib/ai/quota'

/**
 * Streaming analyst chat over Server-Sent Events.
 *
 * Node runtime (the Vercel default) — SSE does not require the edge runtime,
 * and the analyst needs Prisma and the full Node API surface anyway.
 */
export const maxDuration = 300

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  threadId: z.string().trim().min(1).max(120).nullish(),
  /** Seeds a new thread from a vendor or compliance page. */
  entitySlug: z.string().trim().min(1).max(160).nullish(),
})

const encoder = new TextEncoder()

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(request: Request) {
  const guard = await apiRequireUser()
  if (!guard.ok) return guard.response
  const user = guard.user

  // Validate before the availability check so a malformed request always gets
  // an accurate 400, rather than a 503 that hides the real problem.
  const parsed = await parseBody(bodySchema, request)
  if (!parsed.ok) return parsed.response
  const { message, threadId, entitySlug } = parsed.value

  if (!analystConfigured()) {
    return fail('The analyst is not configured on this deployment (ANTHROPIC_API_KEY unset).', 503)
  }

  // Quota is consumed here, before any model call — a user who exhausts their
  // allowance must not be able to trigger paid inference.
  const quota = await checkAnalystQuota(user, { consume: true })
  if (!quota.allowed) {
    return fail(quota.reason ?? 'Daily analyst limit reached', 429, {
      code: 'ANALYST_QUOTA',
      remaining: 0,
      resetAt: quota.resetAt,
    })
  }

  // Resolve or create the thread, scoped to this user.
  let thread = threadId
    ? await prisma.analystThread.findFirst({ where: { id: threadId, userId: user.id } })
    : null
  if (threadId && !thread) return fail('Thread not found', 404)

  if (!thread) {
    thread = await prisma.analystThread.create({
      data: {
        userId: user.id,
        title: deriveTitle(message),
        entitySlug: entitySlug ?? null,
      },
    })
  }

  const priorRows = await prisma.analystMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
    take: 40,
  })

  await prisma.analystMessage.create({
    data: { threadId: thread.id, role: 'USER', content: message },
  })

  const history = [...toMessageHistory(priorRows), { role: 'user' as const, content: message }]
  const context = thread.entitySlug ? await entityContextLine(thread.entitySlug) : null
  const threadId_ = thread.id

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Sent first so the client can attach the thread before any token lands.
      controller.enqueue(
        sse('thread', {
          threadId: threadId_,
          title: thread!.title,
          remaining: quota.remaining,
          limit: quota.limit,
        })
      )

      let text = ''
      const toolSummaries: { name: string; summary: string; isError: boolean }[] = []
      let stopReason: string | null = null

      try {
        for await (const event of runAnalystTurn({ history, context })) {
          switch (event.type) {
            case 'text':
              text += event.text
              controller.enqueue(sse('text', { text: event.text }))
              break
            case 'tool_start':
              controller.enqueue(sse('tool_start', { name: event.name }))
              break
            case 'tool_done':
              toolSummaries.push({
                name: event.name,
                summary: event.summary,
                isError: event.isError,
              })
              controller.enqueue(sse('tool_done', event))
              break
            case 'error':
              controller.enqueue(sse('error', { message: event.message, retryable: event.retryable }))
              break
            case 'done':
              stopReason = event.stopReason
              break
          }
        }

        // Persisted after the turn completes, so a client that disconnects
        // mid-stream still gets whatever the model produced on reload.
        if (text.trim() || toolSummaries.length > 0) {
          await prisma.analystMessage.create({
            data: {
              threadId: threadId_,
              role: 'ASSISTANT',
              content: text,
              toolCalls: JSON.stringify(toolSummaries),
              stopReason,
            },
          })
        }
        await prisma.analystThread.update({
          where: { id: threadId_ },
          data: { updatedAt: new Date() },
        })

        controller.enqueue(sse('done', { threadId: threadId_, stopReason }))
      } catch (err) {
        console.error('[analyst] stream failed:', err)
        controller.enqueue(
          sse('error', { message: 'The analyst stream failed unexpectedly.', retryable: true })
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Defeats proxy buffering, which would otherwise batch the whole
      // response and defeat the point of streaming.
      'X-Accel-Buffering': 'no',
    },
  })
}
