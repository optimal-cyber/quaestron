'use client'

import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/lib/store'
import { ENTITY_TYPE_COLORS, type EntityType } from '@/lib/types'

interface EntityListItem {
  id: string
  name: string
  slug: string
  type: string
  connectionCount: number
}

const ENTITY_TYPES: { value: string; label: string }[] = [
  { value: 'SURVEILLANCE', label: 'Surveillance' },
  { value: 'DEFENSE_PRIME', label: 'Defense Prime' },
  { value: 'CYBER_INTEL', label: 'Cyber Intel' },
  { value: 'AI_ML', label: 'AI / ML' },
  { value: 'INVESTOR', label: 'Investor' },
  { value: 'GOVERNMENT', label: 'Government' },
  { value: 'CLOUD_INFRA', label: 'Cloud Infra' },
  { value: 'STARTUP', label: 'Startup' },
  { value: 'CONSULTANCY', label: 'Consultancy' },
]

export default function EntityList({
  entities,
  loading,
}: {
  entities: EntityListItem[]
  loading: boolean
}) {
  const {
    selectedEntityId,
    selectEntity,
    searchQuery,
    setSearchQuery,
    typeFilters,
    toggleTypeFilter,
    sortBy,
    setSortBy,
    sortDirection,
    toggleSortDirection,
  } = useAppStore()

  const filtered = useMemo(() => {
    let result = entities
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) || e.slug.includes(q)
      )
    }
    if (typeFilters.length > 0) {
      result = result.filter((e) => typeFilters.includes(e.type))
    }
    return result.sort((a, b) => {
      if (sortBy === 'connections') {
        return sortDirection === 'desc'
          ? b.connectionCount - a.connectionCount
          : a.connectionCount - b.connectionCount
      }
      return sortDirection === 'desc'
        ? b.name.localeCompare(a.name)
        : a.name.localeCompare(b.name)
    })
  }, [entities, searchQuery, typeFilters, sortBy, sortDirection])

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-border">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter entities..."
          className="w-full px-3 py-1.5 bg-background border border-border rounded text-xs font-mono text-foreground placeholder:text-muted outline-none focus:border-accent-blue transition-colors"
        />
      </div>

      {/* Filters */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-mono text-muted tracking-wider">TYPES</span>
          {typeFilters.length > 0 && (
            <button
              onClick={() => useAppStore.getState().setTypeFilters([])}
              className="text-[12px] font-mono text-accent-red hover:text-accent-red/80"
            >
              CLEAR
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {ENTITY_TYPES.map((t) => {
            const isActive = typeFilters.includes(t.value)
            const color = ENTITY_TYPE_COLORS[t.value as EntityType] || '#64748B'
            return (
              <button
                key={t.value}
                onClick={() => toggleTypeFilter(t.value)}
                className={`px-2 py-0.5 text-[12px] font-mono rounded transition-colors border ${
                  isActive
                    ? 'border-current'
                    : 'border-transparent opacity-60 hover:opacity-100'
                }`}
                style={{ color }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Sort */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="text-[12px] font-mono text-muted tracking-wider">SORT:</span>
        <button
          onClick={() => setSortBy('name')}
          className={`text-[12px] font-mono ${
            sortBy === 'name' ? 'text-foreground' : 'text-muted hover:text-muted-foreground'
          }`}
        >
          A-Z
        </button>
        <button
          onClick={() => setSortBy('connections')}
          className={`text-[12px] font-mono ${
            sortBy === 'connections' ? 'text-foreground' : 'text-muted hover:text-muted-foreground'
          }`}
        >
          CONNECTIONS
        </button>
        <button
          onClick={toggleSortDirection}
          className="text-[12px] font-mono text-muted hover:text-muted-foreground ml-auto"
        >
          {sortDirection === 'asc' ? '↑' : '↓'}
        </button>
        <span className="text-[12px] font-mono text-muted">{filtered.length}</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-8 bg-surface-hover rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filtered.map((entity) => {
              const isSelected = selectedEntityId === entity.id
              const color = ENTITY_TYPE_COLORS[entity.type as EntityType] || '#64748B'
              return (
                <motion.button
                  key={entity.id}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  onClick={() => selectEntity(isSelected ? null : entity.id)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors border-l-2 ${
                    isSelected
                      ? 'bg-accent-red/5 border-accent-red'
                      : 'border-transparent hover:bg-surface-hover hover:border-border-bright'
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-mono text-xs tracking-wide truncate flex-1">
                    {entity.name}
                  </span>
                  {entity.connectionCount > 0 && (
                    <span className="text-[12px] font-mono text-muted">
                      {entity.connectionCount}
                    </span>
                  )}
                </motion.button>
              )
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}
