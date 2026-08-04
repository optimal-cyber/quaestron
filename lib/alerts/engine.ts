import { prisma } from '@/lib/db'
import { normalizeVendorName } from '@/lib/match/vendor-name'
import {
  ENGINE_LIMITS,
  parseParams,
  RULE_TYPES,
  type Frequency,
  type RuleType,
  type TargetType,
} from './types'
import {
  detectChanges,
  EVALUATORS,
  type EngineData,
  type WatchedEntity,
} from './evaluators'

/**
 * Alert evaluation engine.
 *
 * Called from the existing cron routes after their data refresh — no new cron
 * entries. Ordering within a run matters:
 *
 *   1. Load active rules (+ their watchlist items).
 *   2. Compute the *global* change set once, scoped to what anyone watches.
 *      Doing this per-rule would be wrong as well as slow: the first rule to
 *      evaluate would advance the snapshot baseline and every later rule
 *      watching the same target would see no change.
 *   3. Run each rule's evaluator against that shared change set.
 *   4. Insert events, skipping duplicates via the unique dedupeKey.
 */

export interface EngineResult {
  rulesEvaluated: number
  rulesSkipped: number
  eventsCreated: number
  duplicatesSkipped: number
  fedrampChanges: number
  riskFlagChanges: number
  errors: string[]
  truncated: boolean
  elapsedMs: number
}

export interface RunOptions {
  /** Which cadences to evaluate. Daily cron passes REALTIME+DAILY, weekly WEEKLY. */
  frequencies: Frequency[]
  now?: Date
  /** Override the lookback window (days) for new-row rules. */
  lookbackDays?: number
}

export async function runAlertEngine(options: RunOptions): Promise<EngineResult> {
  const started = Date.now()
  const now = options.now ?? new Date()
  const lookbackDays = options.lookbackDays ?? ENGINE_LIMITS.lookbackDays
  const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000)

  const result: EngineResult = {
    rulesEvaluated: 0,
    rulesSkipped: 0,
    eventsCreated: 0,
    duplicatesSkipped: 0,
    fedrampChanges: 0,
    riskFlagChanges: 0,
    errors: [],
    truncated: false,
    elapsedMs: 0,
  }

  const rules = await prisma.alertRule.findMany({
    where: { active: true, frequency: { in: options.frequencies } },
    take: ENGINE_LIMITS.maxRulesPerRun + 1,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      ruleType: true,
      params: true,
      watchlistId: true,
      watchlist: {
        select: {
          items: {
            take: ENGINE_LIMITS.maxTargetsPerRule,
            select: {
              targetType: true,
              targetId: true,
              targetValue: true,
              targetKey: true,
              label: true,
            },
          },
        },
      },
    },
  })

  if (rules.length > ENGINE_LIMITS.maxRulesPerRun) {
    result.truncated = true
    rules.length = ENGINE_LIMITS.maxRulesPerRun
    console.warn(
      `[alerts] rule cap hit (${ENGINE_LIMITS.maxRulesPerRun}); remaining rules deferred to the next run`
    )
  }

  if (rules.length === 0) {
    result.elapsedMs = Date.now() - started
    return result
  }

  // Union of everything anyone watches — bounds change detection to subscriber
  // interest rather than the whole universe.
  const allEntityIds = new Set<string>()
  const allPackageIds = new Set<string>()
  for (const rule of rules) {
    for (const item of rule.watchlist?.items ?? []) {
      if (item.targetType === 'ENTITY' && item.targetId) allEntityIds.add(item.targetId)
      if (item.targetType === 'FEDRAMP_CSO' && item.targetValue) allPackageIds.add(item.targetValue)
    }
  }

  const entityRows = allEntityIds.size
    ? await prisma.entity.findMany({
        where: { id: { in: [...allEntityIds] } },
        select: { id: true, name: true, slug: true },
      })
    : []
  const entities = new Map<string, WatchedEntity>(entityRows.map((e) => [e.id, e]))
  const cspNames = new Set(entityRows.map((e) => normalizeVendorName(e.name)))

  let changes: Awaited<ReturnType<typeof detectChanges>> = {
    fedrampChanges: [],
    riskFlagChanges: [],
  }
  try {
    changes = await detectChanges({ entityIds: allEntityIds, cspNames, packageIds: allPackageIds })
  } catch (err) {
    result.errors.push(`change detection: ${message(err)}`)
  }

  result.fedrampChanges = changes.fedrampChanges.length
  result.riskFlagChanges = changes.riskFlagChanges.length

  const data: EngineData = {
    entities,
    fedrampChanges: changes.fedrampChanges,
    riskFlagChanges: changes.riskFlagChanges,
  }

  for (const rule of rules) {
    if (!isRuleType(rule.ruleType)) {
      result.rulesSkipped++
      result.errors.push(`rule ${rule.id}: unknown ruleType ${rule.ruleType}`)
      continue
    }

    const targets = (rule.watchlist?.items ?? []).map((item) => ({
      targetType: item.targetType as TargetType,
      targetKey: item.targetKey,
      targetId: item.targetId,
      targetValue: item.targetValue,
      label: item.label,
    }))

    // A rule with no watchlist can't match anything; skip rather than scanning.
    if (targets.length === 0) {
      result.rulesSkipped++
      continue
    }

    try {
      const candidates = await EVALUATORS[rule.ruleType](
        {
          ruleId: rule.id,
          ruleType: rule.ruleType,
          params: parseParams(rule.params),
          targets,
          since,
          now,
        },
        data
      )

      for (const candidate of candidates) {
        try {
          await prisma.alertEvent.create({
            data: {
              ruleId: rule.id,
              userId: rule.userId,
              ruleType: rule.ruleType,
              title: candidate.title,
              body: candidate.body,
              url: candidate.url ?? null,
              dedupeKey: candidate.dedupeKey,
              entityId: candidate.entityId ?? null,
            },
          })
          result.eventsCreated++
        } catch {
          // Unique violation on dedupeKey — already alerted, nothing to do.
          result.duplicatesSkipped++
        }
      }

      await prisma.alertRule.update({
        where: { id: rule.id },
        data: { lastRunAt: now },
      })
      result.rulesEvaluated++
    } catch (err) {
      result.rulesSkipped++
      result.errors.push(`rule ${rule.id} (${rule.ruleType}): ${message(err)}`)
    }
  }

  result.elapsedMs = Date.now() - started
  return result
}

function isRuleType(value: string): value is RuleType {
  return (RULE_TYPES as readonly string[]).includes(value)
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
