'use client'

import { useState } from 'react'
import { ENTITY_TYPE_COLORS, ENTITY_TYPE_LABELS, type EntityType } from '@/lib/types'
import { useAppStore } from '@/lib/store'

interface Stats {
  totalEntities: number
  totalConnections: number
  totalCountries: number
  typeCounts: { type: string; count: number }[]
  mostConnected: { id: string; name: string; slug: string; type: string; connectionCount: number }[]
}

export default function OverviewPanel({ stats }: { stats: Stats | null }) {
  const { selectEntity } = useAppStore()
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/sync/surveillance-watch', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setSyncResult(`Synced ${data.entities} entities, ${data.funders} funders in ${data.elapsed}s`)
        // Reload page to reflect new data
        setTimeout(() => window.location.reload(), 2000)
      } else {
        setSyncResult(`Error: ${data.error}`)
      }
    } catch (err) {
      setSyncResult('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-6">
        <div className="font-mono text-accent-red text-sm tracking-[0.2em] mb-1">
          &#x276E; QUAESTRON
        </div>
        <h1 className="font-mono text-lg tracking-[0.1em] text-foreground mb-1">
          DEFENSE TECH INTELLIGENCE
        </h1>
        <p className="text-xs text-muted font-mono tracking-wider">
          MAPPING THE ARSENAL
        </p>
      </div>

      {stats ? (
        <>
          {/* Aggregate stats */}
          <div className="grid grid-cols-2 gap-2 mb-6">
            <div className="bg-surface border border-border rounded p-3">
              <div className="font-mono text-xl text-foreground">{stats.totalEntities}</div>
              <div className="text-[12px] font-mono text-muted tracking-wider">ENTITIES</div>
            </div>
            <div className="bg-surface border border-border rounded p-3">
              <div className="font-mono text-xl text-foreground">{stats.totalConnections}</div>
              <div className="text-[12px] font-mono text-muted tracking-wider">CONNECTIONS</div>
            </div>
            <div className="bg-surface border border-border rounded p-3">
              <div className="font-mono text-xl text-foreground">{stats.totalCountries}</div>
              <div className="text-[12px] font-mono text-muted tracking-wider">COUNTRIES</div>
            </div>
            <div className="bg-surface border border-border rounded p-3">
              <div className="font-mono text-xl text-foreground">
                {stats.typeCounts.length}
              </div>
              <div className="text-[12px] font-mono text-muted tracking-wider">CATEGORIES</div>
            </div>
          </div>

          {/* Type breakdown */}
          <div className="mb-6">
            <div className="text-[12px] font-mono tracking-wider text-muted mb-3">BY TYPE</div>
            <div className="space-y-1.5">
              {stats.typeCounts.map((tc) => {
                const color = ENTITY_TYPE_COLORS[tc.type as EntityType] || '#64748B'
                const label = ENTITY_TYPE_LABELS[tc.type as EntityType] || tc.type
                const pct = stats.totalEntities > 0 ? (tc.count / stats.totalEntities) * 100 : 0
                return (
                  <div key={tc.type} className="flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs font-mono flex-1 text-muted-foreground">{label}</span>
                    <div className="w-16 h-1 bg-border rounded overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                    <span className="text-[12px] font-mono text-muted w-6 text-right">{tc.count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Most connected */}
          <div>
            <div className="text-[12px] font-mono tracking-wider text-muted mb-3">MOST CONNECTED</div>
            <div className="space-y-1">
              {stats.mostConnected.slice(0, 8).map((entity, i) => {
                const color = ENTITY_TYPE_COLORS[entity.type as EntityType] || '#64748B'
                return (
                  <button
                    key={entity.id}
                    onClick={() => selectEntity(entity.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-hover transition-colors text-left"
                  >
                    <span className="text-[12px] font-mono text-muted w-4">{i + 1}.</span>
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs font-mono flex-1 truncate">{entity.name}</span>
                    <span className="text-[12px] font-mono text-accent-blue">
                      {entity.connectionCount}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Data sync */}
          <div className="border-t border-border pt-4 mt-4">
            <div className="text-[12px] font-mono tracking-wider text-muted mb-3">DATA SOURCE</div>
            <div className="text-[12px] font-mono text-muted-foreground mb-2">
              Surveillance Watch API + USAspending.gov
            </div>
            <div className="text-[12px] font-mono text-muted mb-3">
              Auto-syncs daily at 06:00 UTC
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-[12px] font-mono text-foreground hover:bg-surface-hover hover:border-border-bright transition-colors disabled:opacity-50"
            >
              {syncing ? 'SYNCING...' : 'SYNC NOW'}
            </button>
            {syncResult && (
              <div className="mt-2 text-[12px] font-mono text-accent-green">{syncResult}</div>
            )}
          </div>
        </>
      ) : (
        /* Loading skeleton */
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 bg-surface border border-border rounded animate-pulse" />
            ))}
          </div>
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 bg-surface-hover rounded animate-pulse" />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
