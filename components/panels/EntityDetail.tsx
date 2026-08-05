'use client'

import { motion } from 'framer-motion'
import { ENTITY_TYPE_COLORS, ENTITY_TYPE_LABELS, type EntityType } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import WatchButton from '@/components/WatchButton'

interface Connection {
  id: string
  connectionType: string
  confidence: string
  value: number | null
  targetEntity?: {
    id: string
    name: string
    slug: string
    type: string
    headquartersCountry?: { name: string; alpha2: string; latitude: number; longitude: number } | null
  }
  sourceEntity?: {
    id: string
    name: string
    slug: string
    type: string
    headquartersCountry?: { name: string; alpha2: string; latitude: number; longitude: number } | null
  }
}

interface ContractItem {
  id: string
  description: string | null
  value: number | null
  awardDate: string | null
  agency: { name: string } | null
}

interface CountryRef {
  name: string
  slug: string
  lat: number
  lon: number
}

interface LobbyingFiling {
  id: string
  registrantName: string
  clientName: string
  year: number | null
  period: string | null
  amount: number | null
  issues: string[]
  governmentEntities: string[]
  specificIssues: string | null
}

interface EntityDetailData {
  id: string
  name: string
  slug: string
  type: string
  subTypes: string[]
  description: string
  headquartersCity: string | null
  headquartersCountry: { name: string; alpha2: string } | null
  founded: number | null
  website: string | null
  alsoKnownAs: string[]
  fundingType: string | null
  ticker: string | null
  stockExchange: string | null
  isin: string | null
  hasDirectTargets: boolean
  providingTo: CountryRef[]
  surveilling: CountryRef[]
  sources: { url: string; title: string; domain: string; date?: string }[]
  connectionsFrom: Connection[]
  connectionsTo: Connection[]
  contracts: ContractItem[]
  connectionCount: number
  updatedAt: string
  lobbying?: {
    filings: LobbyingFiling[]
    totalAmount: number
    byYear: Record<number, number>
  }
}

function formatCurrency(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

export default function EntityDetail({
  entity,
  onClose,
}: {
  entity: EntityDetailData
  onClose: () => void
}) {
  const { selectEntity } = useAppStore()
  const typeColor = ENTITY_TYPE_COLORS[entity.type as EntityType] || '#64748B'
  const typeLabel = ENTITY_TYPE_LABELS[entity.type as EntityType] || entity.type

  // Group funder connections
  const fundedBy = entity.connectionsTo
    .filter((c) => ['FUNDED_BY', 'INVESTED_IN'].includes(c.connectionType))
    .map((c) => ({
      id: c.sourceEntity?.id,
      name: c.sourceEntity?.name || 'Unknown',
      country: c.sourceEntity?.headquartersCountry?.name,
    }))

  // Group outgoing investment connections (for investor entities)
  const investedIn = entity.connectionsFrom
    .filter((c) => ['FUNDED_BY', 'INVESTED_IN'].includes(c.connectionType))
    .map((c) => ({
      id: c.targetEntity?.id,
      name: c.targetEntity?.name || 'Unknown',
      type: c.targetEntity?.type,
      country: c.targetEntity?.headquartersCountry?.name,
    }))

  // Other outgoing connections (SUPPLIES_TO, SUBSIDIARY, ACQUIRED, PARTNERSHIP)
  const otherConnections = entity.connectionsFrom
    .filter((c) => !['FUNDED_BY', 'INVESTED_IN'].includes(c.connectionType))
    .map((c) => ({
      id: c.targetEntity?.id,
      name: c.targetEntity?.name || 'Unknown',
      type: c.connectionType,
      country: c.targetEntity?.headquartersCountry?.name,
    }))

  const totalConnections =
    entity.connectionCount +
    (entity.providingTo?.length || 0) +
    (entity.surveilling?.length || 0)

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      className="h-full w-full min-w-0"
    >
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-start justify-between mb-1">
          <h2 className="font-mono text-xl tracking-[0.08em] text-foreground leading-tight uppercase">
            {entity.name}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors p-1 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Headquarters location */}
        {(entity.headquartersCity || entity.headquartersCountry) && (
          <div className="flex items-center gap-1.5 mb-2">
            <svg className="w-3.5 h-3.5 text-accent-red shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
            <div className="text-xs font-mono text-foreground">
              {entity.headquartersCity && (
                <span>{entity.headquartersCity}</span>
              )}
              {entity.headquartersCity && entity.headquartersCountry && (
                <span className="text-muted"> &middot; </span>
              )}
              {entity.headquartersCountry && (
                <span className="text-muted-foreground uppercase">{entity.headquartersCountry.name}</span>
              )}
            </div>
          </div>
        )}
        <div className="text-[10px] text-muted font-mono">
          Updated {new Date(entity.updatedAt).toUTCString().replace(' GMT', ' UTC')}
        </div>

        {/* Tags row */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span
            className="px-2 py-0.5 text-[10px] font-mono rounded border"
            style={{ color: typeColor, borderColor: typeColor }}
          >
            {typeLabel}
          </span>
          {entity.fundingType && (
            <span className="px-2 py-0.5 text-[10px] font-mono text-muted-foreground bg-surface rounded uppercase">
              {entity.fundingType}
            </span>
          )}
        </div>

        {/* Stock info */}
        {entity.ticker && (
          <div className="mt-3 flex items-center gap-3">
            {entity.fundingType === 'public' && (
              <span className="text-[10px] font-mono text-accent-green flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" />
                </svg>
                PUBLICLY TRADED
              </span>
            )}
            <span className="text-xs font-mono text-foreground font-bold">
              {entity.stockExchange}:{entity.ticker}
            </span>
            {entity.isin && (
              <span className="text-[10px] font-mono text-muted">{entity.isin}</span>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-5">
        <div className="flex justify-end">
          <WatchButton targetType="ENTITY" targetId={entity.id} label={entity.name} compact />
        </div>

        {/* Vendor dossier entry point (acquisition lens) */}
        <a
          href={`/vendor/${entity.slug}`}
          className="flex items-center justify-between px-3 py-2 rounded border border-accent-blue/30 bg-accent-blue/5 hover:bg-accent-blue/10 transition-colors group"
        >
          <span className="text-[11px] font-mono tracking-wider text-accent-blue uppercase">
            View Full Vendor Dossier
          </span>
          <span className="text-accent-blue text-xs group-hover:translate-x-0.5 transition-transform">→</span>
        </a>

        {/* Description */}
        {entity.description && (
          <div className="text-sm text-muted-foreground leading-relaxed break-words">
            {entity.description}
          </div>
        )}

        {/* Technology Used In (providingTo countries) */}
        {entity.providingTo && entity.providingTo.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono tracking-[0.15em] text-accent-green uppercase">
                Technology Used In
              </span>
              <span className="w-8 h-0.5 bg-accent-green rounded" />
            </div>
            <div className="flex flex-wrap gap-1">
              {entity.providingTo.map((c, i) => (
                <span
                  key={i}
                  className="text-xs text-muted-foreground hover:text-foreground cursor-default transition-colors"
                >
                  {c.name}{i < entity.providingTo.length - 1 ? ',' : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Surveilling (direct targets) */}
        {entity.surveilling && entity.surveilling.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono tracking-[0.15em] text-accent-gold uppercase">
                Surveilling / Targeting
              </span>
              <span className="w-8 h-0.5 bg-accent-gold rounded" />
            </div>
            <div className="flex flex-wrap gap-1">
              {entity.surveilling.map((c, i) => (
                <span
                  key={i}
                  className="text-xs text-muted-foreground hover:text-foreground cursor-default transition-colors"
                >
                  {c.name}{i < entity.surveilling.length - 1 ? ',' : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Type / Technologies */}
        {entity.subTypes.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono tracking-[0.15em] text-muted uppercase">
                Type
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {entity.subTypes.map((st, i) => (
                <span
                  key={i}
                  className="text-xs text-muted-foreground hover:text-foreground cursor-default transition-colors"
                >
                  {st}{i < entity.subTypes.length - 1 ? ',' : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Funded By */}
        {fundedBy.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono tracking-[0.15em] text-accent-blue uppercase">
                Funded By
              </span>
              <span className="w-8 h-0.5 bg-accent-blue rounded" />
            </div>
            <div className="space-y-0.5">
              {fundedBy.map((f, i) => (
                <button
                  key={i}
                  onClick={() => f.id && selectEntity(f.id)}
                  className="w-full flex items-center justify-between px-1 py-0.5 rounded hover:bg-surface-hover transition-colors text-left"
                >
                  <span className="text-xs text-muted-foreground hover:text-foreground underline decoration-border hover:decoration-muted-foreground transition-colors">
                    {f.name}
                  </span>
                  {f.country && (
                    <span className="text-[10px] text-muted ml-2 shrink-0">{f.country}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Invested In (for investor entities) */}
        {investedIn.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono tracking-[0.15em] text-accent-green uppercase">
                Invested In ({investedIn.length})
              </span>
              <span className="w-8 h-0.5 bg-accent-green rounded" />
            </div>
            <div className="space-y-0.5">
              {investedIn.map((inv, i) => (
                <button
                  key={i}
                  onClick={() => inv.id && selectEntity(inv.id)}
                  className="w-full flex items-center justify-between px-1 py-0.5 rounded hover:bg-surface-hover transition-colors text-left"
                >
                  <span className="text-xs text-muted-foreground hover:text-foreground underline decoration-border hover:decoration-muted-foreground transition-colors">
                    {inv.name}
                  </span>
                  {inv.country && (
                    <span className="text-[10px] text-muted ml-2 shrink-0">{inv.country}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Other Connections */}
        {otherConnections.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono tracking-[0.15em] text-muted uppercase">
                Connections ({otherConnections.length})
              </span>
            </div>
            <div className="space-y-0.5">
              {otherConnections.map((conn, i) => (
                <button
                  key={i}
                  onClick={() => conn.id && selectEntity(conn.id)}
                  className="w-full flex items-center justify-between px-1 py-0.5 rounded hover:bg-surface-hover transition-colors text-left"
                >
                  <span className="text-xs text-muted-foreground hover:text-foreground underline decoration-border hover:decoration-muted-foreground transition-colors">
                    {conn.name}
                  </span>
                  <span className="text-[10px] text-muted ml-2 shrink-0">
                    {conn.type.replace(/_/g, ' ')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Connections summary */}
        {totalConnections > 0 && (
          <div className="text-[10px] font-mono text-muted border-t border-border pt-3">
            CONNECTIONS ({totalConnections})
            {entity.providingTo?.length > 0 && (
              <span className="ml-2">
                &middot; <span className="text-accent-green">{entity.providingTo.length}</span> countries supplied
              </span>
            )}
            {entity.surveilling?.length > 0 && (
              <span className="ml-2">
                &middot; <span className="text-accent-gold">{entity.surveilling.length}</span> countries surveilled
              </span>
            )}
            {fundedBy.length > 0 && (
              <span className="ml-2">
                &middot; <span className="text-accent-blue">{fundedBy.length}</span> funders
              </span>
            )}
            {investedIn.length > 0 && (
              <span className="ml-2">
                &middot; <span className="text-accent-green">{investedIn.length}</span> investments
              </span>
            )}
          </div>
        )}

        {/* Also Known As */}
        {entity.alsoKnownAs.length > 0 && entity.alsoKnownAs.some(Boolean) && (
          <div>
            <div className="text-[10px] font-mono tracking-wider text-muted mb-1 uppercase">Also Known As</div>
            <div className="text-xs text-muted-foreground">
              {entity.alsoKnownAs.filter(Boolean).join(', ')}
            </div>
          </div>
        )}

        {/* Government Contracts */}
        {entity.contracts.length > 0 && (
          <div className="border-t border-border pt-4">
            <div className="text-[10px] font-mono tracking-wider text-muted mb-3 uppercase">
              Government Contracts ({entity.contracts.length})
            </div>
            <div className="space-y-2">
              {entity.contracts.map((contract) => (
                <div key={contract.id} className="px-2 py-1.5 rounded bg-surface border border-border">
                  <div className="flex items-center justify-between mb-1">
                    {contract.agency && (
                      <span className="text-[10px] font-mono text-accent-blue">{contract.agency.name}</span>
                    )}
                    {contract.value && (
                      <span className="text-[10px] font-mono text-accent-green">{formatCurrency(contract.value)}</span>
                    )}
                  </div>
                  {contract.description && (
                    <p className="text-[10px] text-muted-foreground line-clamp-2">{contract.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lobbying Disclosures */}
        {entity.lobbying && entity.lobbying.filings.length > 0 && (
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono tracking-wider text-accent-gold uppercase">
                Lobbying Disclosures ({entity.lobbying.filings.length})
              </span>
              {entity.lobbying.totalAmount > 0 && (
                <span className="text-[10px] font-mono text-accent-gold">
                  {formatCurrency(entity.lobbying.totalAmount)} total
                </span>
              )}
            </div>
            {/* Year breakdown */}
            {Object.keys(entity.lobbying.byYear).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {Object.entries(entity.lobbying.byYear)
                  .sort(([a], [b]) => Number(b) - Number(a))
                  .map(([year, amount]) => (
                    <div key={year} className="px-2 py-1 rounded bg-surface border border-border">
                      <span className="text-[10px] font-mono text-muted">{year}</span>
                      <span className="text-[10px] font-mono text-accent-gold ml-1.5">{formatCurrency(amount)}</span>
                    </div>
                  ))}
              </div>
            )}
            <div className="space-y-2">
              {entity.lobbying.filings.slice(0, 5).map((filing) => (
                <div key={filing.id} className="px-2 py-1.5 rounded bg-surface border border-border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-muted">
                      {filing.year} {filing.period}
                    </span>
                    {filing.amount && (
                      <span className="text-[10px] font-mono text-accent-gold">{formatCurrency(filing.amount)}</span>
                    )}
                  </div>
                  {filing.issues.length > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      Issues: {filing.issues.slice(0, 3).join(', ')}
                    </p>
                  )}
                  {filing.governmentEntities.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Lobbied: {filing.governmentEntities.slice(0, 3).join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sources */}
        {entity.sources.length > 0 && (
          <div className="border-t border-border pt-4">
            <div className="text-[10px] font-mono tracking-wider text-muted mb-3 uppercase">
              Sources ({entity.sources.length})
            </div>
            <div className="space-y-1">
              {entity.sources.map((source, i) => (
                <a
                  key={i}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-surface-hover transition-colors group min-w-0"
                >
                  <span className="text-[10px] text-muted-foreground group-hover:text-foreground flex-1 min-w-0 truncate">
                    {source.title || source.domain}
                  </span>
                  <svg className="w-3 h-3 text-muted group-hover:text-accent-blue shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Website */}
        {entity.website && (
          <div className="border-t border-border pt-4">
            <a
              href={entity.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs font-mono text-accent-blue hover:text-accent-blue/80 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {entity.website}
            </a>
          </div>
        )}
      </div>
    </motion.div>
  )
}
