import { NextResponse } from 'next/server'
import { ZodError, type ZodType } from 'zod'

/**
 * Consistent `{ data, error }` envelope for all API routes added from Phase 1
 * onward. Pre-existing public routes keep their original shapes — they're
 * consumed by shipped clients and must not break.
 */
export type ApiEnvelope<T> = { data: T; error: null } | { data: null; error: string }

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data, error: null }, init)
}

export function fail(error: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ data: null, error, ...extra }, { status })
}

/** Flattens a ZodError into one human-readable line: "field: message; field2: …" */
export function formatZodError(err: ZodError): string {
  return err.issues
    .map((i) => {
      const path = i.path.join('.')
      return path ? `${path}: ${i.message}` : i.message
    })
    .join('; ')
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; response: NextResponse }

/** Validates URL search params against a zod schema. */
export function parseQuery<T>(schema: ZodType<T>, url: URL): Parsed<T> {
  const raw: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key)
    raw[key] = all.length > 1 ? all : all[0]
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    return { ok: false, response: fail(formatZodError(result.error), 400) }
  }
  return { ok: true, value: result.data }
}

/** Validates a JSON request body against a zod schema. */
export async function parseBody<T>(schema: ZodType<T>, request: Request): Promise<Parsed<T>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: fail('Invalid JSON body', 400) }
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    return { ok: false, response: fail(formatZodError(result.error), 400) }
  }
  return { ok: true, value: result.data }
}
