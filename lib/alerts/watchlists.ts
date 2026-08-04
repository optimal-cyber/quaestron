import { prisma } from '@/lib/db'
import { limitsFor, TARGET_TYPES, type TargetType } from './types'
import type { SessionUser } from '@/lib/auth'

/**
 * Watchlist domain logic shared by the API routes.
 *
 * Tier limits are enforced here rather than in each handler so "1 watchlist,
 * 5 items" can't drift between the create path and the one-click WATCH path.
 */

export const DEFAULT_WATCHLIST_NAME = 'Default'

/** Stable key for a target, so the same vendor can't be added twice. */
export function targetKeyFor(input: {
  targetType: TargetType
  targetId?: string | null
  targetValue?: string | null
}): string | null {
  if (input.targetType === 'ENTITY') return input.targetId?.trim() || null
  const value = input.targetValue?.trim()
  if (!value) return null
  // Free-text targets are case-folded so "Palantir" and "palantir" are one item.
  return input.targetType === 'KEYWORD' || input.targetType === 'AGENCY'
    ? value.toLowerCase()
    : value
}

export function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value)
}

export type LimitError = { code: 'WATCHLIST_LIMIT' | 'ITEM_LIMIT'; message: string }

export async function assertCanCreateWatchlist(user: SessionUser): Promise<LimitError | null> {
  const limits = limitsFor(user.tier)
  if (limits.maxWatchlists === Number.POSITIVE_INFINITY) return null

  const count = await prisma.watchlist.count({ where: { userId: user.id } })
  if (count >= limits.maxWatchlists) {
    return {
      code: 'WATCHLIST_LIMIT',
      message: `${user.tier} tier allows ${limits.maxWatchlists} watchlist${limits.maxWatchlists === 1 ? '' : 's'}. Upgrade to Pro for unlimited.`,
    }
  }
  return null
}

export async function assertCanAddItem(
  user: SessionUser,
  watchlistId: string
): Promise<LimitError | null> {
  const limits = limitsFor(user.tier)
  if (limits.maxItemsPerWatchlist === Number.POSITIVE_INFINITY) return null

  const count = await prisma.watchlistItem.count({ where: { watchlistId } })
  if (count >= limits.maxItemsPerWatchlist) {
    return {
      code: 'ITEM_LIMIT',
      message: `${user.tier} tier allows ${limits.maxItemsPerWatchlist} items per watchlist. Upgrade to Pro for unlimited.`,
    }
  }
  return null
}

/** The list the one-click WATCH button targets, created on first use. */
export async function getOrCreateDefaultWatchlist(user: SessionUser) {
  const existing = await prisma.watchlist.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  })
  if (existing) return existing

  return prisma.watchlist.create({
    data: { userId: user.id, name: DEFAULT_WATCHLIST_NAME },
  })
}

/** Confirms the watchlist exists AND belongs to this user. */
export async function ownedWatchlist(userId: string, watchlistId: string) {
  return prisma.watchlist.findFirst({ where: { id: watchlistId, userId } })
}

/** Serializes limits for the client — JSON has no Infinity. */
export function serializeLimits(tier: SessionUser['tier']) {
  const limits = limitsFor(tier)
  return {
    maxWatchlists: Number.isFinite(limits.maxWatchlists) ? limits.maxWatchlists : null,
    maxItemsPerWatchlist: Number.isFinite(limits.maxItemsPerWatchlist)
      ? limits.maxItemsPerWatchlist
      : null,
    frequencies: limits.frequencies,
    channels: limits.channels,
  }
}
