import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { buildCrosswalk } from '@/lib/compliance/crosswalk'
import { queryUniverse } from '@/lib/compliance/universe'
import { safeJsonArray } from '@/lib/compliance/shared'

/**
 * Analyst tool surface.
 *
 * Every tool wraps an existing internal query function. **The model never writes
 * SQL and never receives a free-text query path into the database** — each tool
 * takes typed parameters that map onto a fixed Prisma query, so the worst a bad
 * tool call can do is return no rows.
 *
 * Two conventions the system prompt depends on:
 *
 *  - Results carry a `dataset` field naming the source, so the model can cite
 *    where an answer came from rather than asserting it flatly.
 *  - Absent data is returned as an explicit `null` plus an `available: false`
 *    flag, never as a zero. `Entity.totalFederalObligated` is a cache that is
 *    null until enrichment runs; letting the model read that as "$0 in federal
 *    contracts" would produce confident, wrong answers about real vendors.
 */

/** Every tool result is wrapped so provenance and caveats travel with the data. */
interface ToolEnvelope {
  dataset: string
  [key: string]: unknown
}

function money(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : v
}

// ─── Schemas ───────────────────────────────────────────────────────

/**
 * `strict: true` guarantees the input validates exactly against the schema,
 * which requires `additionalProperties: false` and an explicit `required` list
 * on every object. Worth it here: a malformed tool call would otherwise surface
 * as a confusing empty result rather than a clean retry.
 */
export const ANALYST_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_entities',
    description:
      'Search tracked companies, agencies, and investors by name. Call this FIRST whenever the user names an organization, to resolve it to a slug before using any other tool. Returns up to 20 matches with their slug, type, and headquarters country. If it returns nothing, the organization is not tracked — say so rather than guessing a slug.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Company or agency name, or part of one. Minimum 2 characters.',
        },
        type: {
          type: ['string', 'null'],
          description:
            'Optional filter on entity type, e.g. DEFENSE_PRIME, CYBER_INTEL, AI_ML, CLOUD_INFRA, SURVEILLANCE, GOVERNMENT, INVESTOR, STARTUP. Pass null for no filter.',
        },
      },
      required: ['query', 'type'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_entity_profile',
    description:
      "The primary tool. Returns one vendor's full compliance and spend profile: FedRAMP / DoD provisional / eMASS authorizations with impact levels and assessment due dates, federal obligations by agency, SBIR history, set-asides, and risk flags. Use it for any question about a specific vendor's authorizations, agency relationships, or federal business. Note the spendDataAvailable flag: when false, spend figures are unknown rather than zero.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Entity slug from search_entities, e.g. "palantir".',
        },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_contracts',
    description:
      'List federal contract awards, most valuable first. Filter by vendor slug, awarding agency, minimum dollar value, or award date. Use for "what has X won", "who won the biggest awards at agency Y", or trend questions. Returns at most 50 awards — say so if the result is capped.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        entitySlug: {
          type: ['string', 'null'],
          description: 'Restrict to one vendor. Pass null for all vendors.',
        },
        agency: {
          type: ['string', 'null'],
          description: 'Awarding agency name or fragment, e.g. "Air Force". Null for any.',
        },
        minValue: {
          type: ['number', 'null'],
          description: 'Minimum award value in dollars. Null for no minimum.',
        },
        since: {
          type: ['string', 'null'],
          description: 'ISO date (YYYY-MM-DD); only awards on or after it. Null for no bound.',
        },
      },
      required: ['entitySlug', 'agency', 'minValue', 'since'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_authorizations',
    description:
      'Query the authorized-cloud universe across FedRAMP and DoD provisional authorizations. Filter by impact level, status, or an assessment-due window. Use for market-wide questions ("which vendors hold IL5", "what is due for reassessment in 90 days") rather than single-vendor questions, which get_entity_profile answers better. FedRAMP levels are LI-SaaS, Low, 20x Low, Moderate, 20x Moderate, High; DoD levels are IL2, IL4, IL5, IL6.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        level: {
          type: ['string', 'null'],
          description: 'Exact impact level, e.g. "High" or "IL5". Null for any.',
        },
        status: {
          type: ['string', 'null'],
          description: 'FedRAMP status: Authorized, InProcess, or Ready. Null for any.',
        },
        expiringWithinDays: {
          type: ['number', 'null'],
          description:
            'Only authorizations whose next annual assessment falls within this many days. Null for any.',
        },
        agency: {
          type: ['string', 'null'],
          description: 'Sponsoring agency name or fragment. Null for any.',
        },
      },
      required: ['level', 'status', 'expiringWithinDays', 'agency'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_funding',
    description:
      "A vendor's funding history: individual rounds with amounts and dates, plus totals split between government sources (SBIR/STTR and federal award aggregates) and private capital. Call this for questions about who backs a vendor, how much it has raised, whether it is venture-funded or government-funded, or how well capitalized it is. The `available` flag is false when no funding records exist for the vendor — that means nothing has been ingested, NOT that the vendor is unfunded, and you must not report it as evidence of either. Government and private totals come from different pipelines and a vendor can legitimately have one without the other.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        entitySlug: { type: 'string', description: 'Entity slug from search_entities.' },
      },
      required: ['entitySlug'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_connections',
    description:
      "A vendor's relationship graph: contracts, investments, acquisitions, subsidiaries, partnerships, and supply relationships. Use for questions about who a company works with, owns, or is owned by. depth=1 returns direct relationships; depth=2 also returns the relationships of those neighbours and is much larger — only use it when the question genuinely needs second-order links.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        entitySlug: { type: 'string', description: 'Entity slug from search_entities.' },
        depth: {
          type: 'number',
          description: 'Traversal depth: 1 for direct relationships, 2 for one hop further.',
        },
      },
      required: ['entitySlug', 'depth'],
      additionalProperties: false,
    },
  },
]

// ─── Executors ─────────────────────────────────────────────────────

async function resolveEntity(slug: string) {
  return prisma.entity.findFirst({
    where: { OR: [{ slug }, { id: slug }] },
    select: { id: true, name: true, slug: true, type: true },
  })
}

function notFound(slug: string, dataset: string): ToolEnvelope {
  return {
    dataset,
    found: false,
    message: `No tracked entity matches "${slug}". Use search_entities to find the correct slug, or tell the user this organization is not in the dataset.`,
  }
}

async function searchEntities(input: { query: string; type?: string | null }): Promise<ToolEnvelope> {
  const query = input.query?.trim() ?? ''
  if (query.length < 2) {
    return { dataset: 'Entity', results: [], message: 'Query must be at least 2 characters.' }
  }

  const rows = await prisma.entity.findMany({
    where: {
      AND: [
        {
          OR: [
            { name: { contains: query } },
            { slug: { contains: query.toLowerCase() } },
            { alsoKnownAs: { contains: query } },
          ],
        },
        ...(input.type ? [{ type: input.type }] : []),
      ],
    },
    select: {
      name: true,
      slug: true,
      type: true,
      businessSize: true,
      vendorSyncedAt: true,
      headquartersCountry: { select: { name: true, alpha2: true } },
    },
    take: 20,
  })

  return {
    dataset: 'Entity (Quaestron tracked organizations)',
    resultCount: rows.length,
    results: rows.map((r) => ({
      name: r.name,
      slug: r.slug,
      type: r.type,
      businessSize: r.businessSize,
      country: r.headquartersCountry?.name ?? null,
      enriched: Boolean(r.vendorSyncedAt),
    })),
  }
}

async function getEntityProfile(input: { slug: string }): Promise<ToolEnvelope> {
  const crosswalk = await buildCrosswalk(input.slug)
  if (!crosswalk) return notFound(input.slug, 'compliance crosswalk')

  return {
    dataset:
      'ATO↔contract crosswalk (FedRAMP Marketplace, DISA DCAS, eMASS, USASpending, SAM.gov)',
    entity: crosswalk.entity,
    authorizations: {
      summary: crosswalk.authorizations.summary,
      fedramp: crosswalk.authorizations.fedramp,
      dodPa: crosswalk.authorizations.dodPa,
      emass: crosswalk.authorizations.emass,
    },
    spend: {
      ...crosswalk.spend,
      // Restated at the point of use so a model skimming the object can't miss it.
      totalFederalObligated: crosswalk.spendDataAvailable
        ? crosswalk.spend.totalFederalObligated
        : null,
    },
    spendDataAvailable: crosswalk.spendDataAvailable,
    spendCaveat: crosswalk.spendDataAvailable
      ? null
      : 'Vendor enrichment has not run for this entity. Federal obligation totals are UNKNOWN, not zero. Do not state or imply this vendor has won no federal work.',
    sbir: crosswalk.sbir,
    agencyLeverage: crosswalk.agencyLeverage,
    whitespace: crosswalk.whitespace,
    dateCaveat:
      'FedRAMP authorizations do not hard-expire. Dates shown are the next annual assessment due date; an authorization lapses only if the assessment is not met.',
  }
}

async function listContracts(input: {
  entitySlug?: string | null
  agency?: string | null
  minValue?: number | null
  since?: string | null
}): Promise<ToolEnvelope> {
  let entityId: string | undefined
  if (input.entitySlug) {
    const entity = await resolveEntity(input.entitySlug)
    if (!entity) return notFound(input.entitySlug, 'Contract')
    entityId = entity.id
  }

  const since = input.since ? new Date(input.since) : null
  const validSince = since && !Number.isNaN(since.getTime()) ? since : null

  const LIMIT = 50
  const rows = await prisma.contract.findMany({
    where: {
      ...(entityId ? { entityId } : {}),
      ...(input.minValue ? { value: { gte: input.minValue } } : {}),
      ...(validSince ? { awardDate: { gte: validSince } } : {}),
      ...(input.agency ? { agency: { name: { contains: input.agency } } } : {}),
    },
    select: {
      description: true,
      value: true,
      awardDate: true,
      naicsCode: true,
      sbirProgram: true,
      sbirPhase: true,
      entity: { select: { name: true, slug: true } },
      agency: { select: { name: true } },
    },
    orderBy: { value: 'desc' },
    take: LIMIT,
  })

  return {
    dataset: 'Contract (USASpending.gov awards + SBIR/STTR)',
    resultCount: rows.length,
    truncated: rows.length === LIMIT,
    totalValueOfListed: rows.reduce((sum, r) => sum + (r.value || 0), 0),
    contracts: rows.map((r) => ({
      vendor: r.entity.name,
      vendorSlug: r.entity.slug,
      agency: r.agency?.name ?? null,
      value: money(r.value),
      awardDate: r.awardDate?.toISOString().slice(0, 10) ?? null,
      naicsCode: r.naicsCode,
      description: r.description?.slice(0, 240) ?? null,
      sbir: r.sbirProgram ? `${r.sbirProgram}${r.sbirPhase ? ` Phase ${r.sbirPhase}` : ''}` : null,
    })),
  }
}

async function listAuthorizations(input: {
  level?: string | null
  status?: string | null
  expiringWithinDays?: number | null
  agency?: string | null
}): Promise<ToolEnvelope> {
  const result = await queryUniverse({
    impactLevel: input.level ?? undefined,
    status: input.status ?? undefined,
    agency: input.agency ?? undefined,
    expiringWithinDays: input.expiringWithinDays ?? undefined,
    sort: input.expiringWithinDays ? 'expiration' : 'level',
    limit: 50,
  })

  return {
    dataset: 'FedRAMP Marketplace + DISA DCAS provisional authorizations',
    matchingTotal: result.total,
    returned: result.rows.length,
    truncated: result.total > result.rows.length,
    dateCaveat:
      'Dates are next annual assessment due dates, not hard expirations. FedRAMP authorizations lapse only if the assessment is unmet.',
    authorizations: result.rows.map((r) => ({
      vendor: r.vendor,
      vendorSlug: r.entity?.slug ?? null,
      linkedToTrackedVendor: r.entity !== null,
      offering: r.offering,
      source: r.source,
      impactLevel: r.impactLevel,
      status: r.status,
      sponsoringAgency: r.sponsoringAgency,
      leveragingAgencyCount: r.leveragingCount,
      assessmentDueInDays: r.daysRemaining,
      smallBusiness: r.smallBusiness,
      totalFederalObligated: r.entity ? money(r.entity.totalFederalObligated) : null,
    })),
  }
}

async function getFunding(input: { entitySlug: string }): Promise<ToolEnvelope> {
  const entity = await resolveEntity(input.entitySlug)
  if (!entity) return notFound(input.entitySlug, 'FundingRound')

  const rounds = await prisma.fundingRound.findMany({
    where: { entityId: entity.id },
    orderBy: { date: 'desc' },
    take: 50,
  })

  let governmentTotal = 0
  let privateTotal = 0
  for (const r of rounds) {
    if (r.source === 'government') governmentTotal += r.amount || 0
    else privateTotal += r.amount || 0
  }

  return {
    dataset: 'FundingRound (Apollo.io private funding + government award aggregates)',
    vendor: entity.name,
    roundCount: rounds.length,
    governmentTotal,
    privateTotal,
    available: rounds.length > 0,
    caveat:
      rounds.length === 0
        ? 'No funding records for this vendor. That means none have been ingested — it is not evidence the vendor is unfunded.'
        : null,
    rounds: rounds.map((r) => ({
      roundName: r.roundName,
      roundType: r.roundType,
      amount: money(r.amount),
      date: r.date?.toISOString().slice(0, 10) ?? null,
      source: r.source,
      provider: r.provider,
    })),
  }
}

async function getConnections(input: {
  entitySlug: string
  depth?: number
}): Promise<ToolEnvelope> {
  const entity = await resolveEntity(input.entitySlug)
  if (!entity) return notFound(input.entitySlug, 'Connection')

  const depth = input.depth === 2 ? 2 : 1
  const select = {
    connectionType: true,
    description: true,
    value: true,
    confidence: true,
    sourceEntity: { select: { name: true, slug: true, type: true } },
    targetEntity: { select: { name: true, slug: true, type: true } },
  } as const

  const direct = await prisma.connection.findMany({
    where: { OR: [{ sourceEntityId: entity.id }, { targetEntityId: entity.id }] },
    select,
    take: 100,
  })

  const shape = (rows: typeof direct, anchorSlug: string) =>
    rows.map((c) => {
      const outbound = c.sourceEntity.slug === anchorSlug
      const other = outbound ? c.targetEntity : c.sourceEntity
      return {
        direction: outbound ? 'outbound' : 'inbound',
        relationship: c.connectionType,
        counterparty: other.name,
        counterpartySlug: other.slug,
        counterpartyType: other.type,
        value: money(c.value),
        confidence: c.confidence,
        description: c.description?.slice(0, 200) ?? null,
      }
    })

  const result: ToolEnvelope = {
    dataset: 'Connection (Quaestron relationship graph)',
    vendor: entity.name,
    depth,
    directCount: direct.length,
    direct: shape(direct, entity.slug),
  }

  if (depth === 2) {
    const neighbourSlugs = [
      ...new Set(
        direct.flatMap((c) => [c.sourceEntity.slug, c.targetEntity.slug]).filter((s) => s !== entity.slug)
      ),
    ].slice(0, 15)

    const second = await prisma.connection.findMany({
      where: {
        OR: [
          { sourceEntity: { slug: { in: neighbourSlugs } } },
          { targetEntity: { slug: { in: neighbourSlugs } } },
        ],
        NOT: { OR: [{ sourceEntityId: entity.id }, { targetEntityId: entity.id }] },
      },
      select,
      take: 100,
    })

    result.secondDegreeCount = second.length
    result.secondDegreeNote = `Relationships among the ${neighbourSlugs.length} nearest neighbours, excluding ${entity.name}'s own.`
    result.secondDegree = second.map((c) => ({
      relationship: c.connectionType,
      from: c.sourceEntity.name,
      to: c.targetEntity.name,
      value: money(c.value),
      confidence: c.confidence,
    }))
  }

  return result
}

// ─── Dispatch ──────────────────────────────────────────────────────

type Executor = (input: never) => Promise<ToolEnvelope>

const EXECUTORS: Record<string, Executor> = {
  search_entities: searchEntities as Executor,
  get_entity_profile: getEntityProfile as Executor,
  list_contracts: listContracts as Executor,
  list_authorizations: listAuthorizations as Executor,
  get_funding: getFunding as Executor,
  get_connections: getConnections as Executor,
}

export interface ToolRun {
  name: string
  input: unknown
  result: unknown
  isError: boolean
  /** One-line human summary for the transcript and the UI's QUERYING line. */
  summary: string
}

/** Short description of what a call did, for the inline UI and the saved transcript. */
function summarize(name: string, input: Record<string, unknown>, result: ToolEnvelope): string {
  const count =
    (result.resultCount as number | undefined) ??
    (result.returned as number | undefined) ??
    (result.directCount as number | undefined) ??
    (result.roundCount as number | undefined)

  switch (name) {
    case 'search_entities':
      return `search "${input.query}" → ${count ?? 0} match${count === 1 ? '' : 'es'}`
    case 'get_entity_profile':
      return result.found === false
        ? `profile "${input.slug}" → not tracked`
        : `profile "${input.slug}" → ${(result.authorizations as { summary?: { total?: number } })?.summary?.total ?? 0} authorizations`
    case 'list_contracts':
      return `contracts${input.entitySlug ? ` for ${input.entitySlug}` : ''} → ${count ?? 0}`
    case 'list_authorizations':
      return `authorizations${input.level ? ` at ${input.level}` : ''} → ${result.matchingTotal ?? 0} matching`
    case 'get_funding':
      return `funding for ${input.entitySlug} → ${count ?? 0} rounds`
    case 'get_connections':
      return `connections for ${input.entitySlug} (depth ${input.depth ?? 1}) → ${count ?? 0}`
    default:
      return name
  }
}

/**
 * Runs one tool call. Never throws — a failure comes back as an error result the
 * model can react to, because an exception here would kill the whole stream and
 * lose the conversation mid-answer.
 */
export async function runTool(name: string, rawInput: unknown): Promise<ToolRun> {
  const executor = EXECUTORS[name]
  const input = (rawInput ?? {}) as Record<string, unknown>

  if (!executor) {
    return {
      name,
      input,
      result: { error: `Unknown tool "${name}".` },
      isError: true,
      summary: `unknown tool ${name}`,
    }
  }

  try {
    const result = await (executor as (i: unknown) => Promise<ToolEnvelope>)(input)
    return { name, input, result, isError: false, summary: summarize(name, input, result) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[analyst] tool ${name} failed:`, message)
    return {
      name,
      input,
      result: { error: `Tool "${name}" failed: ${message}` },
      isError: true,
      summary: `${name} failed`,
    }
  }
}

/** Used by the deep-link buttons to seed a thread with real vendor context. */
export async function entityContextLine(slug: string): Promise<string | null> {
  const entity = await prisma.entity.findFirst({
    where: { OR: [{ slug }, { id: slug }] },
    select: { name: true, slug: true, type: true, riskFlags: true },
  })
  if (!entity) return null
  const flags = safeJsonArray(entity.riskFlags)
  return `${entity.name} (slug: ${entity.slug}, type: ${entity.type}${flags.length ? `, risk flags: ${flags.join(', ')}` : ''})`
}
