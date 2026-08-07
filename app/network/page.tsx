'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { sankey, sankeyLinkHorizontal, type SankeyNode, type SankeyLink } from 'd3-sankey'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import SearchCommand from '@/components/layout/SearchCommand'
import { useAppStore } from '@/lib/store'
import { ENTITY_TYPE_COLORS, ENTITY_TYPE_LABELS, type EntityType } from '@/lib/types'

interface SNode {
  id: string
  name: string
  type: string
  column: number
  nodeIndex?: number
}

interface SLink {
  source: number
  target: number
  value: number
}

interface EntityResult {
  id: string
  name: string
  type: string
  connectionCount: number
  headquartersCountry?: { name: string } | null
}

interface DetailData {
  id: string
  name: string
  type: string
  connectionsFrom: Array<{
    connectionType: string
    targetEntity: { id: string; name: string; type: string }
  }>
  connectionsTo: Array<{
    connectionType: string
    sourceEntity: { id: string; name: string; type: string }
  }>
  contracts: Array<{
    agency: { id: string; name: string } | null
    value: number | null
  }>
  providingTo: Array<{ name: string }>
  surveilling: Array<{ name: string }>
  subTypes: string[]
}

const COLUMN_COLORS = ['#4A7C9B', '#C8102E', '#2ECC71']

export default function NetworkPage() {
  const { setSearchOpen } = useAppStore()
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<EntityResult[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState('')
  const [loading, setLoading] = useState(false)
  const [entityData, setEntityData] = useState<DetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; type: string; detail: string } | null>(null)

  // Search entities
  useEffect(() => {
    if (!search || search.length < 2) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/entities?search=${encodeURIComponent(search)}&limit=20&sort=connections&direction=desc`)
        .then((r) => r.json())
        .then((d) => setResults(d.entities || []))
        .catch(() => {})
    }, 200)
    return () => clearTimeout(timer)
  }, [search])

  // Keep a stable ref to buildEntitySankey so the useCallback always calls latest
  const buildRef = useRef<((entity: DetailData) => void) | null>(null)

  // Fetch entity detail — store in state, let useEffect handle rendering
  const selectAndBuild = useCallback(async (id: string, name: string) => {
    setSelectedId(id)
    setSelectedName(name)
    setSearch('')
    setResults([])
    setLoading(true)
    setEntityData(null)
    setError(null)

    try {
      const res = await fetch(`/api/entities/${id}`)
      if (!res.ok) {
        setError(`Failed to load entity (${res.status})`)
        return
      }
      const entity: DetailData = await res.json()
      if (!entity || entity.id === undefined) {
        setError('Invalid entity data')
        return
      }
      setEntityData(entity)
    } catch (err) {
      console.error(err)
      setError('Network error loading entity')
    } finally {
      setLoading(false)
    }
  }, [])

  // Build Sankey AFTER loading is done and SVG is mounted
  useEffect(() => {
    if (loading || !entityData) return
    // Wait for React to render the SVG element
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        buildRef.current?.(entityData)
      })
    })
  }, [loading, entityData])

  // Load a default entity on mount (most connected)
  useEffect(() => {
    fetch('/api/entities?sort=connections&direction=desc&limit=1')
      .then((r) => r.json())
      .then((d) => {
        if (d.entities?.[0]) {
          selectAndBuild(d.entities[0].id, d.entities[0].name)
        }
      })
      .catch(() => {})
  }, [selectAndBuild])

  const buildEntitySankey = (entity: DetailData) => {  // eslint-disable-line @typescript-eslint/no-use-before-define
    const svgEl = svgRef.current
    const container = containerRef.current
    if (!svgEl || !container) return

    const svg = d3.select(svgEl)
    svg.selectAll('*').remove()

    const width = container.clientWidth
    const height = container.clientHeight - 20
    if (width < 200 || height < 100) return // Container not laid out yet
    svg.attr('width', width).attr('height', height + 20)

    const isMobile = width < 768
    const MARGIN = isMobile
      ? { left: 80, right: 80, top: 30, bottom: 20 }
      : { left: 180, right: 180, top: 30, bottom: 20 }

    const nodes: SNode[] = []
    const links: SLink[] = []
    const nodeMap = new Map<string, number>()

    function getNodeIdx(id: string, name: string, type: string, column: number): number {
      const key = `${column}:${id}`
      if (nodeMap.has(key)) return nodeMap.get(key)!
      const idx = nodes.length
      nodeMap.set(key, idx)
      nodes.push({ id, name, type, column })
      return idx
    }

    // Center node: the selected entity
    const centerIdx = getNodeIdx(entity.id, entity.name, entity.type, 1)

    // Defensive: normalize potentially-undefined arrays
    const connectionsTo = entity.connectionsTo || []
    const connectionsFrom = entity.connectionsFrom || []
    const contracts = entity.contracts || []

    // Left column: funders/investors (connectionsTo with INVESTED_IN/FUNDED_BY)
    const funders = connectionsTo.filter(
      (c) => ['INVESTED_IN', 'FUNDED_BY'].includes(c.connectionType)
    )
    for (const conn of funders) {
      if (!conn.sourceEntity) continue
      const srcIdx = getNodeIdx(conn.sourceEntity.id, conn.sourceEntity.name, conn.sourceEntity.type, 0)
      links.push({ source: srcIdx, target: centerIdx, value: 1 })
    }

    // Also add other incoming connections (SUBSIDIARY, PARTNERSHIP) on the left
    const otherIncoming = connectionsTo.filter(
      (c) => !['INVESTED_IN', 'FUNDED_BY'].includes(c.connectionType)
    )
    for (const conn of otherIncoming) {
      if (!conn.sourceEntity) continue
      const srcIdx = getNodeIdx(conn.sourceEntity.id, conn.sourceEntity.name, conn.sourceEntity.type, 0)
      links.push({ source: srcIdx, target: centerIdx, value: 1 })
    }

    // Right column: entities funded (for investors), agencies (contracts), countries
    for (const conn of connectionsFrom) {
      if (!conn.targetEntity) continue
      const tgtIdx = getNodeIdx(conn.targetEntity.id, conn.targetEntity.name, conn.targetEntity.type, 2)
      links.push({ source: centerIdx, target: tgtIdx, value: 1 })
    }

    // Contracts -> agencies
    const agencyMap = new Map<string, number>()
    for (const contract of contracts) {
      if (!contract.agency) continue
      const existing = agencyMap.get(contract.agency.id) || 0
      agencyMap.set(contract.agency.id, existing + (contract.value || 1))
    }
    for (const [agencyId, value] of agencyMap) {
      const contract = contracts.find((c) => c.agency?.id === agencyId)
      if (!contract?.agency) continue
      const tgtIdx = getNodeIdx(agencyId, contract.agency.name, 'GOVERNMENT', 2)
      links.push({ source: centerIdx, target: tgtIdx, value: Math.log10(Math.max(value, 1)) + 1 })
    }

    // ProvidingTo countries
    for (const country of entity.providingTo || []) {
      const tgtIdx = getNodeIdx(`country:${country.name}`, country.name, 'COUNTRY', 2)
      links.push({ source: centerIdx, target: tgtIdx, value: 1 })
    }

    // Surveilling countries
    for (const country of entity.surveilling || []) {
      const tgtIdx = getNodeIdx(`surveilling:${country.name}`, country.name, 'SURVEILLING_TARGET', 2)
      links.push({ source: centerIdx, target: tgtIdx, value: 1 })
    }

    // SubTypes as right-side nodes
    for (const st of entity.subTypes || []) {
      const tgtIdx = getNodeIdx(`subtype:${st}`, st, 'SUBTYPE', 2)
      links.push({ source: centerIdx, target: tgtIdx, value: 0.5 })
    }

    if (links.length === 0) {
      // Show empty state
      svg.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#64748b')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-size', '12px')
        .text('No connections found for this entity')
      return
    }

    // Build Sankey
    const sankeyNodes = nodes.map((n, i) => ({ ...n, nodeIndex: i }))
    const sankeyLinks = links.map((l) => ({ ...l }))

    const sankeyLayout = sankey<SNode & { nodeIndex: number }, SLink>()
      .nodeId((d) => d.nodeIndex)
      .nodeWidth(18)
      .nodePadding(12)
      .extent([[MARGIN.left, MARGIN.top], [width - MARGIN.right, height - MARGIN.bottom]])

    const graph = sankeyLayout({ nodes: sankeyNodes, links: sankeyLinks })

    // Column labels
    const leftLabel = funders.length > 0 ? 'FUNDERS / INVESTORS' : 'INCOMING'
    const rightLabel = 'OUTGOING / ENDPOINTS'
    const headerG = svg.append('g')

    headerG.append('text')
      .attr('x', MARGIN.left).attr('y', 16)
      .attr('fill', COLUMN_COLORS[0]).attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '10px').attr('font-weight', '700')
      .attr('letter-spacing', '0.12em').text(leftLabel)

    headerG.append('text')
      .attr('x', width / 2).attr('y', 16).attr('text-anchor', 'middle')
      .attr('fill', COLUMN_COLORS[1]).attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '10px').attr('font-weight', '700')
      .attr('letter-spacing', '0.12em').text('SELECTED ENTITY')

    headerG.append('text')
      .attr('x', width - MARGIN.right).attr('y', 16).attr('text-anchor', 'end')
      .attr('fill', COLUMN_COLORS[2]).attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '10px').attr('font-weight', '700')
      .attr('letter-spacing', '0.12em').text(rightLabel)

    const mainG = svg.append('g')

    // Links
    mainG.append('g')
      .attr('fill', 'none')
      .selectAll('path')
      .data(graph.links)
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke', (d) => {
        const sourceNode = d.source as SankeyNode<SNode, SLink>
        return COLUMN_COLORS[sourceNode.column] || '#64748B'
      })
      .attr('stroke-width', (d) => Math.max(2, d.width || 1))
      .attr('stroke-opacity', 0.35)
      .style('mix-blend-mode', 'screen')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('stroke-opacity', 0.8).raise()
        const src = (d.source as SankeyNode<SNode, SLink>) as unknown as SNode
        const tgt = (d.target as SankeyNode<SNode, SLink>) as unknown as SNode
        const rect = container.getBoundingClientRect()
        setTooltip({
          x: event.clientX - rect.left, y: event.clientY - rect.top,
          name: src.name, type: `→ ${tgt.name}`, detail: '',
        })
      })
      .on('mouseleave', function () {
        d3.select(this).attr('stroke-opacity', 0.35)
        setTooltip(null)
      })

    // Nodes
    const nodeRects = mainG.append('g')
      .selectAll('rect')
      .data(graph.nodes)
      .join('rect')
      .attr('x', (d) => d.x0!)
      .attr('y', (d) => d.y0!)
      .attr('width', (d) => d.x1! - d.x0!)
      .attr('height', (d) => Math.max(3, d.y1! - d.y0!))
      .attr('fill', (d) => {
        const node = d as unknown as SNode
        if (node.type === 'COUNTRY') return '#2ECC71'
        if (node.type === 'SURVEILLING_TARGET') return '#B8953E'
        if (node.type === 'SUBTYPE') return '#8B5CF6'
        if (node.id === entity.id) return '#C8102E'
        return ENTITY_TYPE_COLORS[node.type as EntityType] || COLUMN_COLORS[node.column] || '#64748B'
      })
      .attr('rx', 3)
      .attr('opacity', 1)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('filter', 'brightness(1.3)')
        const node = d as unknown as SNode & SankeyNode<SNode, SLink>
        const connCount = (d.sourceLinks?.length || 0) + (d.targetLinks?.length || 0)
        const typeLabel = node.type === 'COUNTRY' ? 'Supplying To'
          : node.type === 'SURVEILLING_TARGET' ? 'Surveilling'
          : node.type === 'SUBTYPE' ? 'Technology'
          : (ENTITY_TYPE_LABELS[node.type as EntityType] || node.type)
        const rect = container.getBoundingClientRect()
        setTooltip({
          x: event.clientX - rect.left, y: event.clientY - rect.top,
          name: node.name, type: typeLabel, detail: `${connCount} flows`,
        })

        // Highlight connected
        mainG.selectAll('path')
          .attr('stroke-opacity', (l: unknown) => {
            const link = l as SankeyLink<SNode, SLink>
            const src = link.source as SankeyNode<SNode, SLink>
            const tgt = link.target as SankeyNode<SNode, SLink>
            return src.index === d.index || tgt.index === d.index ? 0.8 : 0.05
          })

        const connected = new Set<number>([d.index!])
        for (const sl of d.sourceLinks || []) connected.add((sl.target as SankeyNode<SNode, SLink>).index!)
        for (const tl of d.targetLinks || []) connected.add((tl.source as SankeyNode<SNode, SLink>).index!)
        nodeRects.attr('opacity', (n) => connected.has(n.index!) ? 1 : 0.2)
        labels.attr('fill-opacity', (n) => connected.has(n.index!) ? 1 : 0.15)
      })
      .on('mouseleave', function () {
        d3.select(this).attr('filter', null)
        setTooltip(null)
        mainG.selectAll('path').attr('stroke-opacity', 0.35)
        nodeRects.attr('opacity', 1)
        labels.attr('fill-opacity', 1)
      })
      .on('click', (_, d) => {
        const node = d as unknown as SNode
        if (!node.type.startsWith('COUNTRY') && node.type !== 'SURVEILLING_TARGET' && node.type !== 'SUBTYPE') {
          selectAndBuild(node.id, node.name)
        }
      })

    // Labels
    const labels = mainG.append('g')
      .selectAll('text')
      .data(graph.nodes)
      .join('text')
      .attr('x', (d) => {
        const node = d as unknown as SNode & SankeyNode<SNode, SLink>
        if (node.column === 0) return d.x0! - 8
        if (node.column === 2) return d.x1! + 8
        return (d.x0! + d.x1!) / 2
      })
      .attr('y', (d) => (d.y0! + d.y1!) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d) => {
        const node = d as unknown as SNode & SankeyNode<SNode, SLink>
        return node.column === 0 ? 'end' : node.column === 2 ? 'start' : 'middle'
      })
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', (d) => {
        const node = d as unknown as SNode
        if (isMobile) return node.id === entity.id ? '9px' : '7px'
        return node.id === entity.id ? '12px' : '10px'
      })
      .attr('font-weight', (d) => {
        const node = d as unknown as SNode
        return node.id === entity.id ? '700' : '400'
      })
      .attr('fill', '#e2e8f0')
      .style('pointer-events', 'none')
      .text((d) => {
        const node = d as unknown as SNode
        const maxLen = isMobile ? (node.column === 1 ? 16 : 12) : (node.column === 1 ? 30 : 22)
        return node.name.length > maxLen ? node.name.slice(0, maxLen - 2) + '..' : node.name
      })
  }
  buildRef.current = buildEntitySankey

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B0F1A]">
      <TopNav onSearchOpen={() => setSearchOpen(true)} />
      <SearchCommand />

      <div className="flex-1 pt-12 pb-7 flex flex-col min-h-0">
        {/* Search bar */}
        <div className="px-3 md:px-6 py-3 border-b border-white/5 flex items-center gap-2 md:gap-4">
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entity, funder, or agency..."
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded text-sm font-mono text-white placeholder:text-slate-500 outline-none focus:border-[#4A7C9B] transition-colors"
            />
            {results.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#111827] border border-white/10 rounded-lg shadow-2xl z-50 max-h-72 overflow-y-auto">
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => selectAndBuild(r.id, r.name)}
                    className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors flex items-center gap-3 border-b border-white/5 last:border-0"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: ENTITY_TYPE_COLORS[r.type as EntityType] || '#64748B' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono text-white truncate">{r.name}</div>
                      <div className="text-[12px] text-slate-500">
                        {ENTITY_TYPE_LABELS[r.type as EntityType] || r.type}
                        {r.headquartersCountry && ` · ${r.headquartersCountry.name}`}
                      </div>
                    </div>
                    <span className="text-[12px] font-mono text-slate-500">{r.connectionCount}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedName && (
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-[12px] font-mono text-slate-500 tracking-wider">VIEWING:</span>
              <span className="text-sm font-mono text-white font-bold truncate max-w-[200px]">{selectedName}</span>
            </div>
          )}
        </div>

        {/* Sankey diagram */}
        <div className="flex-1 relative min-h-[300px]" ref={containerRef}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="font-mono text-xs text-slate-500 tracking-[0.3em] mb-2 animate-pulse">BUILDING</div>
                <div className="font-mono text-[#C8102E] text-sm tracking-[0.2em]">SUPPLY CHAIN MAP</div>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="font-mono text-xs text-[#C8102E] tracking-[0.3em] mb-2">ERROR</div>
                <div className="font-mono text-slate-400 text-xs max-w-[300px]">{error}</div>
                <button
                  onClick={() => { setError(null); if (selectedId) { setLoading(true); fetch(`/api/entities/${selectedId}`).then(r => r.json()).then(d => { setEntityData(d); setLoading(false); }).catch(() => { setError('Retry failed'); setLoading(false); }); } }}
                  className="mt-3 font-mono text-[12px] text-slate-500 border border-slate-700 px-3 py-1 hover:text-white hover:border-slate-500 transition-colors tracking-wider"
                >
                  RETRY
                </button>
              </div>
            </div>
          ) : (
            <>
              <svg ref={svgRef} className="absolute inset-0 w-full h-full" />

              {tooltip && (
                <div
                  className="absolute z-50 pointer-events-none px-3 py-2 rounded border border-white/15 font-mono"
                  style={{
                    left: Math.min(tooltip.x + 16, (containerRef.current?.clientWidth || 800) - 220),
                    top: tooltip.y - 10,
                    background: 'rgba(11, 15, 26, 0.95)',
                    backdropFilter: 'blur(8px)',
                  }}
                >
                  <div className="text-xs text-white font-bold">{tooltip.name}</div>
                  <div className="text-[12px] text-slate-400">{tooltip.type}</div>
                  {tooltip.detail && <div className="text-[11px] text-slate-500">{tooltip.detail}</div>}
                </div>
              )}

              {/* Hint */}
              <div className="absolute bottom-2 right-4 z-10 font-mono text-[11px] text-slate-600 tracking-wider">
                CLICK A NODE TO EXPLORE ITS CONNECTIONS
              </div>
            </>
          )}
        </div>
      </div>

      <BottomBar />
    </div>
  )
}
