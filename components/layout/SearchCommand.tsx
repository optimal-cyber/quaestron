'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/lib/store'

interface SearchResult {
  id: string
  name: string
  slug: string
  type: string
  connectionCount: number
  headquartersCountry?: { name: string; alpha2: string } | null
}

export default function SearchCommand() {
  const { isSearchOpen, setSearchOpen, selectEntity } = useAppStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<NodeJS.Timeout>(null)

  // Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(!isSearchOpen)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSearchOpen, setSearchOpen])

  // Focus input when opened
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
      setQuery('')
      setResults([])
      setSelectedIndex(0)
    }
  }, [isSearchOpen])

  // Search
  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults(data.results || [])
      setSelectedIndex(0)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInputChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 300)
  }

  const handleSelect = (result: SearchResult) => {
    selectEntity(result.id)
    setSearchOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex])
    }
  }

  const typeColor: Record<string, string> = {
    DEFENSE_PRIME: '#C8102E',
    CYBER_INTEL: '#4A7C9B',
    SURVEILLANCE: '#B8953E',
    AI_ML: '#8B5CF6',
    INVESTOR: '#2ECC71',
    GOVERNMENT: '#6B7280',
    CLOUD_INFRA: '#3B82F6',
    STARTUP: '#F59E0B',
    CONSULTANCY: '#EC4899',
  }

  return (
    <AnimatePresence>
      {isSearchOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            onClick={() => setSearchOpen(false)}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 z-[101] w-full max-w-lg"
          >
            <div className="bg-surface border border-border rounded-lg shadow-2xl overflow-hidden">
              {/* Input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search entities, companies, agencies..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted outline-none font-mono"
                />
                {loading && (
                  <div className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
                )}
              </div>

              {/* Results */}
              {results.length > 0 && (
                <div className="max-h-80 overflow-y-auto p-2">
                  {results.map((result, i) => (
                    <button
                      key={result.id}
                      onClick={() => handleSelect(result)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded text-left transition-colors ${
                        i === selectedIndex
                          ? 'bg-surface-hover'
                          : 'hover:bg-surface-hover'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: typeColor[result.type] || '#64748B' }}
                      />
                      <span className="font-mono text-sm tracking-wide flex-1">
                        {result.name}
                      </span>
                      {result.headquartersCountry && (
                        <span className="text-xs text-muted">
                          {result.headquartersCountry.alpha2}
                        </span>
                      )}
                      <span className="text-xs text-muted font-mono">
                        {result.connectionCount}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {query.length >= 2 && results.length === 0 && !loading && (
                <div className="px-4 py-8 text-center text-sm text-muted">
                  No results found for &ldquo;{query}&rdquo;
                </div>
              )}

              {/* Footer */}
              <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[12px] font-mono text-muted">
                <span>↑↓ Navigate</span>
                <span>↵ Select</span>
                <span>ESC Close</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
