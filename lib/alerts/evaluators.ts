import { prisma } from '@/lib/db'
import { normalizeVendorName } from '@/lib/match/vendor-name'
import {
  ENGINE_LIMITS,
  expiryBucket,
  type CandidateEvent,
  type EvaluatorContext,
  type ResolvedTarget,
  type RuleType,
} from './types'

/**
 * Rule evaluators.
 *
 * Two detection strategies, chosen per rule type:
 *
 *  - **New-row rules** (NEW_CONTRACT, NEW_SBIR_AWARD, NEWS_MENTION) query source
 *    rows by `createdAt` over a lookback window. The window is deliberately
 *    wider than the cron cadence so a skipped run self-heals; the unique
 *    `dedupeKey` makes the overlap a no-op.
 *
 *  - **Change rules** (FEDRAMP_STATUS_CHANGE, RISK_FLAG_ADDED) can't use
 *    `createdAt` — the sync overwrites rows in place. They read a diff computed
 *    once per run against `AlertSnapshot` baselines (see detectChanges below).
 */

export interface WatchedEntity {
  id: string
  name: string
  slug: string
}

export interface FedrampChange {
  packageId: string
  csoName: string
  cspName: string
  previous: { status: string; impactLevel: string | null }
  current: { status: string; impactLevel: string | null }
}

export interface RiskFlagChange {
  entityId: string
  entityName: string
  entitySlug: string
  added: string[]
}

export interface EngineData {
  entities: Map<string, WatchedEntity>
  fedrampChanges: FedrampChange[]
  riskFlagChanges: RiskFlagChange[]
}

// ─── Target indexing ───────────────────────────────────────────────

export interface TargetIndex {
  entityIds: Set<string>
  entityNames: string[] // normalized, for name-based matching against ATO tables
  packageIds: Set<string>
  agencies: string[] // lowercased
  keywords: string[] // lowercased
  naics: Set<string>
}

export function buildTargetIndex(
  targets: ResolvedTarget[],
  entities: Map<string, WatchedEntity>
): TargetIndex {
  const index: TargetIndex = {
    entityIds: new Set(),
    entityNames: [],
    packageIds: new Set(),
    agencies: [],
    keywords: [],
    naics: new Set(),
  }

  for (const t of targets.slice(0, ENGINE_LIMITS.maxTargetsPerRule)) {
    switch (t.targetType) {
      case 'ENTITY': {
        if (!t.targetId) break
        index.entityIds.add(t.targetId)
        const entity = entities.get(t.targetId)
        if (entity) index.entityNames.push(normalizeVendorName(entity.name))
        break
      }
      case 'FEDRAMP_CSO':
        if (t.targetValue) index.packageIds.add(t.targetValue)
        break
      case 'AGENCY':
        if (t.targetValue) index.agencies.push(t.targetValue.toLowerCase())
        break
      case 'KEYWORD':
        if (t.targetValue) index.keywords.push(t.targetValue.toLowerCase())
        break
      case 'NAICS':
        if (t.targetValue) index.naics.add(t.targetValue.trim())
        break
    }
  }

  return index
}

function isEmpty(index: TargetIndex): boolean {
  return (
    index.entityIds.size === 0 &&
    index.packageIds.size === 0 &&
    index.agencies.length === 0 &&
    index.keywords.length === 0 &&
    index.naics.size === 0
  )
}

// ─── Helpers ───────────────────────────────────────────────────────

function fmtUsd(value: number | null | undefined): string {
  const v = value || 0
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return 'unknown date'
  return d.toISOString().slice(0, 10)
}

function matchesAgency(index: TargetIndex, ...fields: (string | null | undefined)[]): boolean {
  if (index.agencies.length === 0) return false
  for (const field of fields) {
    if (!field) continue
    const lower = field.toLowerCase()
    if (index.agencies.some((a) => lower.includes(a) || a.includes(lower))) return true
  }
  return false
}

function matchesKeyword(index: TargetIndex, ...fields: (string | null | undefined)[]): boolean {
  if (index.keywords.length === 0) return false
  for (const field of fields) {
    if (!field) continue
    const lower = field.toLowerCase()
    if (index.keywords.some((k) => lower.includes(k))) return true
  }
  return false
}

/** Name-based ATO↔entity matching. Phase 3 replaces this with real FKs. */
function matchesWatchedName(index: TargetIndex, ...names: (string | null | undefined)[]): boolean {
  if (index.entityNames.length === 0) return false
  for (const name of names) {
    if (!name) continue
    const normalized = normalizeVendorName(name)
    if (!normalized) continue
    if (index.entityNames.some((n) => n === normalized)) return true
  }
  return false
}

function cap(events: CandidateEvent[]): CandidateEvent[] {
  return events.slice(0, ENGINE_LIMITS.maxEventsPerRule)
}

// ─── Change detection (runs once per engine invocation) ────────────

/**
 * Diffs FedRAMP status/impact-level and Entity risk flags against stored
 * baselines, then advances the baselines.
 *
 * Scoped to keys somebody actually watches, so cost tracks subscriber interest
 * rather than universe size.
 *
 * A key seen for the first time is recorded silently and produces no change —
 * otherwise the first run after deploy would report the entire watched universe
 * as having "changed".
 */
export async function detectChanges(scope: {
  entityIds: Set<string>
  cspNames: Set<string>
  packageIds: Set<string>
}): Promise<{ fedrampChanges: FedrampChange[]; riskFlagChanges: RiskFlagChange[] }> {
  const fedrampChanges = await detectFedrampChanges(scope.packageIds, scope.cspNames)
  const riskFlagChanges = await detectRiskFlagChanges(scope.entityIds)
  return { fedrampChanges, riskFlagChanges }
}

async function detectFedrampChanges(
  packageIds: Set<string>,
  cspNames: Set<string>
): Promise<FedrampChange[]> {
  if (packageIds.size === 0 && cspNames.size === 0) return []

  // Name matching is normalized in JS, so fetch by packageId and let the
  // normalized-name pass filter the rest.
  const rows = await prisma.fedrampAuthorization.findMany({
    select: { packageId: true, csoName: true, cspName: true, status: true, impactLevel: true },
  })

  const relevant = rows.filter(
    (r) => packageIds.has(r.packageId) || cspNames.has(normalizeVendorName(r.cspName))
  )
  if (relevant.length === 0) return []

  const snapshots = await prisma.alertSnapshot.findMany({
    where: { kind: 'fedramp:status', key: { in: relevant.map((r) => r.packageId) } },
    select: { key: true, value: true },
  })
  const baseline = new Map(snapshots.map((s) => [s.key, s.value]))

  const changes: FedrampChange[] = []
  const writes: Promise<unknown>[] = []

  for (const row of relevant) {
    const current = `${row.status}|${row.impactLevel ?? ''}`
    const previous = baseline.get(row.packageId)

    if (previous === current) continue

    if (previous !== undefined) {
      const [prevStatus, prevLevel] = previous.split('|')
      changes.push({
        packageId: row.packageId,
        csoName: row.csoName,
        cspName: row.cspName,
        previous: { status: prevStatus, impactLevel: prevLevel || null },
        current: { status: row.status, impactLevel: row.impactLevel },
      })
    }

    writes.push(
      prisma.alertSnapshot.upsert({
        where: { kind_key: { kind: 'fedramp:status', key: row.packageId } },
        create: { kind: 'fedramp:status', key: row.packageId, value: current },
        update: { value: current },
      })
    )
  }

  await Promise.all(writes)
  return changes
}

async function detectRiskFlagChanges(entityIds: Set<string>): Promise<RiskFlagChange[]> {
  if (entityIds.size === 0) return []

  const rows = await prisma.entity.findMany({
    where: { id: { in: [...entityIds] } },
    select: { id: true, name: true, slug: true, riskFlags: true },
  })
  if (rows.length === 0) return []

  const snapshots = await prisma.alertSnapshot.findMany({
    where: { kind: 'entity:riskFlags', key: { in: rows.map((r) => r.id) } },
    select: { key: true, value: true },
  })
  const baseline = new Map(snapshots.map((s) => [s.key, s.value]))

  const changes: RiskFlagChange[] = []
  const writes: Promise<unknown>[] = []

  for (const row of rows) {
    const flags = safeArray(row.riskFlags).sort()
    const current = JSON.stringify(flags)
    const previous = baseline.get(row.id)

    if (previous === current) continue

    if (previous !== undefined) {
      const before = new Set<string>(safeParseArray(previous))
      const added = flags.filter((f) => !before.has(f))
      // Only additions are alertable; a flag clearing is good news, not an alert.
      if (added.length > 0) {
        changes.push({
          entityId: row.id,
          entityName: row.name,
          entitySlug: row.slug,
          added,
        })
      }
    }

    writes.push(
      prisma.alertSnapshot.upsert({
        where: { kind_key: { kind: 'entity:riskFlags', key: row.id } },
        create: { kind: 'entity:riskFlags', key: row.id, value: current },
        update: { value: current },
      })
    )
  }

  await Promise.all(writes)
  return changes
}

function safeArray(raw: string | null): string[] {
  if (!raw) return []
  return safeParseArray(raw)
}

function safeParseArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

// ─── Evaluators ────────────────────────────────────────────────────

const RISK_FLAG_LABELS: Record<string, string> = {
  SAM_INACTIVE: 'SAM registration inactive',
  EXPIRING_AUTH: 'Authorization expiring',
  FOREIGN_HQ: 'Foreign headquarters',
  SURVEILLANCE_TIES: 'Surveillance ties',
}

/** New contract awards on watched entities, agencies, or NAICS codes. */
export async function evaluateNewContract(
  ctx: EvaluatorContext,
  data: EngineData
): Promise<CandidateEvent[]> {
  const index = buildTargetIndex(ctx.targets, data.entities)
  if (isEmpty(index)) return []

  const minValue = ctx.params.minValue ?? 0
  const events: CandidateEvent[] = []

  // SBIR awards land in the same table but have their own rule type — excluding
  // them here keeps a single award from firing two alerts.
  const contracts = await prisma.contract.findMany({
    where: {
      createdAt: { gte: ctx.since },
      sbirProgram: null,
      ...(index.entityIds.size > 0 && index.naics.size === 0 && index.agencies.length === 0
        ? { entityId: { in: [...index.entityIds] } }
        : {}),
    },
    select: {
      id: true, awardId: true, description: true, value: true, awardDate: true,
      naicsCode: true, entityId: true,
      entity: { select: { name: true, slug: true } },
      agency: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  for (const c of contracts) {
    const matched =
      index.entityIds.has(c.entityId) ||
      (c.naicsCode ? index.naics.has(c.naicsCode) : false) ||
      matchesAgency(index, c.agency?.name)
    if (!matched) continue
    if ((c.value || 0) < minValue) continue

    events.push({
      dedupeKey: `NEW_CONTRACT:${ctx.ruleId}:contract:${c.id}`,
      title: `${c.entity.name} — new contract ${fmtUsd(c.value)}`,
      body: [
        c.description?.slice(0, 300),
        c.agency?.name ? `Agency: ${c.agency.name}` : null,
        c.awardDate ? `Awarded ${fmtDate(c.awardDate)}` : null,
        c.naicsCode ? `NAICS ${c.naicsCode}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      url: `/vendor/${c.entity.slug}`,
      entityId: c.entityId,
    })
  }

  // USASpending obligations land in FederalContract, which links to Entity only
  // softly (no FK), so match on the cached entityId or the awarding agency.
  const federal = await prisma.federalContract.findMany({
    where: { createdAt: { gte: ctx.since } },
    select: {
      id: true, recipientName: true, awardAmount: true, description: true,
      awardingAgency: true, awardingSubAgency: true, startDate: true,
      naicsCode: true, entityId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  for (const f of federal) {
    const matched =
      (f.entityId ? index.entityIds.has(f.entityId) : false) ||
      (f.naicsCode ? index.naics.has(f.naicsCode) : false) ||
      matchesAgency(index, f.awardingAgency, f.awardingSubAgency)
    if (!matched) continue
    if ((f.awardAmount || 0) < minValue) continue

    events.push({
      dedupeKey: `NEW_CONTRACT:${ctx.ruleId}:federal:${f.id}`,
      title: `${f.recipientName} — new federal obligation ${fmtUsd(f.awardAmount)}`,
      body: [
        f.description?.slice(0, 300),
        f.awardingAgency ? `Agency: ${f.awardingAgency}` : null,
        f.startDate ? `Start ${fmtDate(f.startDate)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      url: '/contracts',
      entityId: f.entityId,
    })
  }

  return cap(events)
}

/** FedRAMP status or impact-level transitions on watched offerings/vendors. */
export async function evaluateFedrampStatusChange(
  ctx: EvaluatorContext,
  data: EngineData
): Promise<CandidateEvent[]> {
  const index = buildTargetIndex(ctx.targets, data.entities)
  if (index.packageIds.size === 0 && index.entityNames.length === 0) return []

  const events: CandidateEvent[] = []

  for (const change of data.fedrampChanges) {
    const matched =
      index.packageIds.has(change.packageId) || matchesWatchedName(index, change.cspName)
    if (!matched) continue

    const statusMoved = change.previous.status !== change.current.status
    const levelMoved = change.previous.impactLevel !== change.current.impactLevel
    const parts: string[] = []
    if (statusMoved) parts.push(`Status: ${change.previous.status} → ${change.current.status}`)
    if (levelMoved) {
      parts.push(
        `Impact level: ${change.previous.impactLevel || 'none'} → ${change.current.impactLevel || 'none'}`
      )
    }

    events.push({
      // The new value is part of the key so each distinct transition alerts once,
      // while a flapping value that returns to a prior state does not re-alert.
      dedupeKey: `FEDRAMP_STATUS_CHANGE:${ctx.ruleId}:${change.packageId}:${change.current.status}|${change.current.impactLevel ?? ''}`,
      title: `${change.csoName} (${change.cspName}) — FedRAMP change`,
      body: parts.join('\n'),
      url: '/ato',
    })
  }

  return cap(events)
}

/** Authorizations approaching expiry, alerting once per threshold bucket. */
export async function evaluateAtoExpiring(
  ctx: EvaluatorContext,
  data: EngineData
): Promise<CandidateEvent[]> {
  const index = buildTargetIndex(ctx.targets, data.entities)
  if (isEmpty(index)) return []

  const days = ctx.params.days ?? 90
  const cutoff = new Date(ctx.now)
  cutoff.setDate(cutoff.getDate() + days)
  const window = { gte: ctx.now, lte: cutoff }

  const [fedramp, dodPa, emass] = await Promise.all([
    prisma.fedrampAuthorization.findMany({
      where: { expirationDate: window },
      select: {
        packageId: true, csoName: true, cspName: true, impactLevel: true,
        expirationDate: true, sponsoringAgency: true,
      },
    }),
    prisma.dodProvisionalAuth.findMany({
      where: { paExpiration: window },
      select: {
        id: true, csoName: true, cspName: true, impactLevel: true,
        paExpiration: true, sponsorComponent: true,
      },
    }),
    prisma.emassAuthorization.findMany({
      where: { expirationDate: window },
      select: {
        id: true, systemName: true, component: true, authorizationType: true,
        impactLevel: true, expirationDate: true, cloudProvider: true,
      },
    }),
  ])

  const events: CandidateEvent[] = []
  const daysUntil = (d: Date) =>
    Math.ceil((d.getTime() - ctx.now.getTime()) / (1000 * 60 * 60 * 24))

  for (const r of fedramp) {
    if (!r.expirationDate) continue
    const matched =
      index.packageIds.has(r.packageId) ||
      matchesWatchedName(index, r.cspName) ||
      matchesAgency(index, r.sponsoringAgency)
    if (!matched) continue

    const remaining = daysUntil(r.expirationDate)
    const bucket = expiryBucket(remaining)
    if (bucket === null) continue

    events.push({
      dedupeKey: `ATO_EXPIRING:${ctx.ruleId}:fedramp:${r.packageId}:${bucket}`,
      title: `${r.csoName} (${r.cspName}) — FedRAMP authorization expires in ${remaining}d`,
      body: [
        `Expiration: ${fmtDate(r.expirationDate)}`,
        r.impactLevel ? `Impact level: ${r.impactLevel}` : null,
        r.sponsoringAgency ? `Sponsor: ${r.sponsoringAgency}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      url: '/ato',
    })
  }

  for (const r of dodPa) {
    if (!r.paExpiration) continue
    const matched =
      matchesWatchedName(index, r.cspName) || matchesAgency(index, r.sponsorComponent)
    if (!matched) continue

    const remaining = daysUntil(r.paExpiration)
    const bucket = expiryBucket(remaining)
    if (bucket === null) continue

    events.push({
      dedupeKey: `ATO_EXPIRING:${ctx.ruleId}:dod-pa:${r.id}:${bucket}`,
      title: `${r.csoName} (${r.cspName}) — DoD ${r.impactLevel} PA expires in ${remaining}d`,
      body: [
        `Expiration: ${fmtDate(r.paExpiration)}`,
        `Impact level: ${r.impactLevel}`,
        r.sponsorComponent ? `Sponsor: ${r.sponsorComponent}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      url: '/ato',
    })
  }

  for (const r of emass) {
    if (!r.expirationDate) continue
    const matched =
      matchesWatchedName(index, r.cloudProvider) || matchesAgency(index, r.component)
    if (!matched) continue

    const remaining = daysUntil(r.expirationDate)
    const bucket = expiryBucket(remaining)
    if (bucket === null) continue

    events.push({
      dedupeKey: `ATO_EXPIRING:${ctx.ruleId}:emass:${r.id}:${bucket}`,
      title: `${r.systemName} — ${r.authorizationType} expires in ${remaining}d`,
      body: [
        `Expiration: ${fmtDate(r.expirationDate)}`,
        `Component: ${r.component}`,
        r.impactLevel ? `Impact level: ${r.impactLevel}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      url: '/ato',
    })
  }

  return cap(events)
}

/** New SBIR/STTR awards for watched entities, keywords, or agencies. */
export async function evaluateNewSbirAward(
  ctx: EvaluatorContext,
  data: EngineData
): Promise<CandidateEvent[]> {
  const index = buildTargetIndex(ctx.targets, data.entities)
  if (isEmpty(index)) return []

  const awards = await prisma.contract.findMany({
    where: { createdAt: { gte: ctx.since }, sbirProgram: { not: null } },
    select: {
      id: true, description: true, value: true, awardDate: true,
      sbirProgram: true, sbirPhase: true, sbirAgency: true, sbirBranch: true,
      sbirAbstract: true, sbirKeywords: true, entityId: true,
      entity: { select: { name: true, slug: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const events: CandidateEvent[] = []

  for (const a of awards) {
    const matched =
      index.entityIds.has(a.entityId) ||
      matchesAgency(index, a.sbirAgency, a.sbirBranch) ||
      matchesKeyword(index, a.description, a.sbirAbstract, a.sbirKeywords, a.entity.name)
    if (!matched) continue

    const program = a.sbirProgram || 'SBIR'
    const phase = a.sbirPhase ? ` Phase ${a.sbirPhase}` : ''

    events.push({
      dedupeKey: `NEW_SBIR_AWARD:${ctx.ruleId}:${a.id}`,
      title: `${a.entity.name} — ${program}${phase} award ${fmtUsd(a.value)}`,
      body: [
        a.description?.slice(0, 300),
        a.sbirAgency ? `Agency: ${a.sbirAgency}${a.sbirBranch ? ` / ${a.sbirBranch}` : ''}` : null,
        a.awardDate ? `Awarded ${fmtDate(a.awardDate)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      url: `/vendor/${a.entity.slug}`,
      entityId: a.entityId,
    })
  }

  return cap(events)
}

/** A watched entity gained a risk flag. */
export async function evaluateRiskFlagAdded(
  ctx: EvaluatorContext,
  data: EngineData
): Promise<CandidateEvent[]> {
  const index = buildTargetIndex(ctx.targets, data.entities)
  if (index.entityIds.size === 0) return []

  const events: CandidateEvent[] = []

  for (const change of data.riskFlagChanges) {
    if (!index.entityIds.has(change.entityId)) continue

    const labels = change.added.map((f) => RISK_FLAG_LABELS[f] || f)

    events.push({
      dedupeKey: `RISK_FLAG_ADDED:${ctx.ruleId}:${change.entityId}:${change.added.slice().sort().join(',')}`,
      title: `${change.entityName} — risk flag added: ${labels.join(', ')}`,
      body: `New flags: ${labels.join('\n')}`,
      url: `/vendor/${change.entitySlug}`,
      entityId: change.entityId,
    })
  }

  return cap(events)
}

/** A watched entity was linked to a newly ingested news item. */
export async function evaluateNewsMention(
  ctx: EvaluatorContext,
  data: EngineData
): Promise<CandidateEvent[]> {
  const index = buildTargetIndex(ctx.targets, data.entities)
  if (index.entityIds.size === 0) return []

  // NewsItemEntity carries no timestamp of its own, so the window comes from the
  // parent NewsItem's createdAt.
  const links = await prisma.newsItemEntity.findMany({
    where: {
      entityId: { in: [...index.entityIds] },
      newsItem: { createdAt: { gte: ctx.since } },
    },
    select: {
      entityId: true,
      newsItem: { select: { id: true, title: true, url: true, source: true, publishedAt: true, summary: true } },
      entity: { select: { name: true } },
    },
    take: 500,
  })

  return cap(
    links.map((l) => ({
      dedupeKey: `NEWS_MENTION:${ctx.ruleId}:${l.newsItem.id}:${l.entityId}`,
      title: `${l.entity.name} — mentioned in "${l.newsItem.title.slice(0, 120)}"`,
      body: [
        l.newsItem.summary?.slice(0, 300),
        `Source: ${l.newsItem.source}`,
        `Published ${fmtDate(l.newsItem.publishedAt)}`,
      ]
        .filter(Boolean)
        .join('\n'),
      url: l.newsItem.url,
      entityId: l.entityId,
    }))
  )
}

export const EVALUATORS: Record<
  RuleType,
  (ctx: EvaluatorContext, data: EngineData) => Promise<CandidateEvent[]>
> = {
  NEW_CONTRACT: evaluateNewContract,
  FEDRAMP_STATUS_CHANGE: evaluateFedrampStatusChange,
  ATO_EXPIRING: evaluateAtoExpiring,
  NEW_SBIR_AWARD: evaluateNewSbirAward,
  RISK_FLAG_ADDED: evaluateRiskFlagAdded,
  NEWS_MENTION: evaluateNewsMention,
}
