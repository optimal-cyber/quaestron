'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import TopNav from '@/components/layout/TopNav'
import BottomBar from '@/components/layout/BottomBar'
import SearchCommand from '@/components/layout/SearchCommand'
import AtoMatchReview from '@/components/panels/AtoMatchReview'
import { useAppStore } from '@/lib/store'

// --- Types ---

interface SyncStatus {
  id: string
  source: string
  lastSyncAt: string | null
  recordsAdded: number
  recordsUpdated: number
  recordsFailed: number
  status: string
}

interface RecordCounts {
  [table: string]: number
}

interface ImportResult {
  success: boolean
  imported: number
  failed: number
  errors: string[]
}

interface CSVPreview {
  headers: string[]
  rows: string[][]
}

// --- Helpers ---

function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

function syncStatusBadge(status: string): string {
  const s = status.toLowerCase()
  if (s === 'success' || s === 'completed') return 'text-accent-green bg-accent-green/10'
  if (s === 'running' || s === 'in_progress') return 'text-accent-gold bg-accent-gold/10'
  if (s === 'failed' || s === 'error') return 'text-accent-red bg-accent-red/10'
  return 'text-muted bg-surface'
}

// Default eMASS column mappings
const EMASS_FIELDS = [
  'systemName',
  'systemId',
  'component',
  'authType',
  'authDate',
  'expirationDate',
  'impactLevel',
  'skip',
] as const

// Default DISA PA column mappings
const DISA_FIELDS = [
  'csoName',
  'cspName',
  'ilLevel',
  'paDate',
  'expirationDate',
  'sponsor',
  'source',
  'skip',
] as const

function parseCSV(text: string): CSVPreview {
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
  const rows = lines.slice(1, 11).map((line) => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  })
  return { headers, rows }
}

export default function AdminPage() {
  const { setSearchOpen } = useAppStore()

  // Sync status
  const [syncStatuses, setSyncStatuses] = useState<SyncStatus[]>([])
  const [syncLoading, setSyncLoading] = useState(true)
  const [syncingSource, setSyncingSource] = useState<string | null>(null)

  // Record counts
  const [recordCounts, setRecordCounts] = useState<RecordCounts>({})

  // eMASS import
  const [emassFile, setEmassFile] = useState<File | null>(null)
  const [emassPreview, setEmassPreview] = useState<CSVPreview | null>(null)
  const [emassMapping, setEmassMapping] = useState<Record<number, string>>({})
  const [emassImporting, setEmassImporting] = useState(false)
  const [emassResult, setEmassResult] = useState<ImportResult | null>(null)
  const emassInputRef = useRef<HTMLInputElement>(null)

  // DISA import
  const [disaFile, setDisaFile] = useState<File | null>(null)
  const [disaPreview, setDisaPreview] = useState<CSVPreview | null>(null)
  const [disaMapping, setDisaMapping] = useState<Record<number, string>>({})
  const [disaImporting, setDisaImporting] = useState(false)
  const [disaResult, setDisaResult] = useState<ImportResult | null>(null)
  const disaInputRef = useRef<HTMLInputElement>(null)

  // Seed state
  const [seeding, setSeeding] = useState(false)
  const [seedResult, setSeedResult] = useState<string | null>(null)

  // Fetch sync status + record counts
  const fetchStatus = useCallback(() => {
    setSyncLoading(true)
    Promise.all([
      fetch('/api/admin/sync-status').then((r) => r.json()),
    ])
      .then(([statusData]) => {
        setSyncStatuses(statusData.sources || statusData.syncs || [])
        setRecordCounts(statusData.counts || {})
      })
      .catch(console.error)
      .finally(() => setSyncLoading(false))
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Trigger sync for a source
  const triggerSync = async (source: string) => {
    setSyncingSource(source)
    try {
      const endpoint = source.toLowerCase().replace(/\s+/g, '-')
      const res = await fetch(`/api/admin/sync/${endpoint}`, { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        alert(`Sync failed: ${data.error}`)
      }
      fetchStatus()
    } catch (err) {
      console.error(err)
      alert('Sync request failed')
    } finally {
      setSyncingSource(null)
    }
  }

  // Handle CSV file upload
  const handleFileUpload = (
    file: File,
    setFileState: (f: File) => void,
    setPreviewState: (p: CSVPreview) => void,
    setMappingState: (m: Record<number, string>) => void,
    fields: readonly string[]
  ) => {
    setFileState(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const preview = parseCSV(text)
      setPreviewState(preview)
      // Auto-map columns by header name matching
      const mapping: Record<number, string> = {}
      preview.headers.forEach((header, i) => {
        const lower = header.toLowerCase().replace(/[^a-z]/g, '')
        const match = fields.find((f) => {
          const fl = f.toLowerCase()
          return lower.includes(fl) || fl.includes(lower)
        })
        if (match) mapping[i] = match
      })
      setMappingState(mapping)
    }
    reader.readAsText(file)
  }

  // Import eMASS
  const importEmass = async () => {
    if (!emassFile) return
    setEmassImporting(true)
    setEmassResult(null)
    try {
      const formData = new FormData()
      formData.append('file', emassFile)
      formData.append('mapping', JSON.stringify(emassMapping))
      const res = await fetch('/api/admin/import/emass', { method: 'POST', body: formData })
      const data = await res.json()
      setEmassResult(data)
      if (data.success) fetchStatus()
    } catch (err) {
      console.error(err)
      setEmassResult({ success: false, imported: 0, failed: 0, errors: ['Upload failed'] })
    } finally {
      setEmassImporting(false)
    }
  }

  // Import DISA PA
  const importDisa = async () => {
    if (!disaFile) return
    setDisaImporting(true)
    setDisaResult(null)
    try {
      const formData = new FormData()
      formData.append('file', disaFile)
      formData.append('mapping', JSON.stringify(disaMapping))
      const res = await fetch('/api/admin/import/disa-pa', { method: 'POST', body: formData })
      const data = await res.json()
      setDisaResult(data)
      if (data.success) fetchStatus()
    } catch (err) {
      console.error(err)
      setDisaResult({ success: false, imported: 0, failed: 0, errors: ['Upload failed'] })
    } finally {
      setDisaImporting(false)
    }
  }

  // Seed DISA PA
  const seedDisa = async () => {
    setSeeding(true)
    setSeedResult(null)
    try {
      const res = await fetch('/api/admin/sync/disa-seed', { method: 'POST' })
      const data = await res.json()
      setSeedResult(data.message || (data.error ? `Error: ${data.error}` : 'Seed completed'))
      fetchStatus()
    } catch (err) {
      console.error(err)
      setSeedResult('Seed request failed')
    } finally {
      setSeeding(false)
    }
  }

  // Drop zone handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const renderDropZone = (
    label: string,
    file: File | null,
    inputRef: React.RefObject<HTMLInputElement | null>,
    onFile: (f: File) => void,
    accentColor: string
  ) => (
    <div
      onDragOver={handleDragOver}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const droppedFile = e.dataTransfer.files[0]
        if (droppedFile) onFile(droppedFile)
      }}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:border-${accentColor}/50 ${
        file ? `border-${accentColor}/30 bg-${accentColor}/5` : 'border-border'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
        }}
      />
      {file ? (
        <div>
          <span className={`text-xs font-mono text-${accentColor}`}>{file.name}</span>
          <p className="text-[10px] text-muted mt-1">
            {(file.size / 1024).toFixed(1)} KB — Click or drop to replace
          </p>
        </div>
      ) : (
        <div>
          <p className="text-sm text-muted-foreground mb-1">{label}</p>
          <p className="text-[10px] text-muted">Drop CSV file or click to browse</p>
        </div>
      )}
    </div>
  )

  const renderPreviewTable = (preview: CSVPreview) => (
    <div className="overflow-x-auto mt-3 border border-border rounded">
      <table className="w-full">
        <thead className="bg-surface border-b border-border">
          <tr>
            {preview.headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 text-[9px] font-mono tracking-wider text-muted uppercase whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/30">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 text-[10px] font-mono text-muted-foreground whitespace-nowrap max-w-[200px] truncate">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const renderMappingControls = (
    preview: CSVPreview,
    mapping: Record<number, string>,
    setMapping: (m: Record<number, string>) => void,
    fields: readonly string[]
  ) => (
    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
      {preview.headers.map((header, i) => (
        <div key={i} className="flex flex-col gap-1">
          <span className="text-[9px] font-mono text-muted tracking-wider truncate">{header}</span>
          <select
            value={mapping[i] || 'skip'}
            onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })}
            className="px-2 py-1 bg-surface border border-border rounded text-[10px] font-mono text-foreground focus:outline-none focus:border-accent-blue/50"
          >
            <option value="skip">— SKIP —</option>
            {fields.filter((f) => f !== 'skip').map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )

  const renderImportResult = (result: ImportResult) => (
    <div className={`mt-3 p-3 rounded border ${result.success ? 'border-accent-green/30 bg-accent-green/5' : 'border-accent-red/30 bg-accent-red/5'}`}>
      <div className="flex items-center gap-3">
        <span className={`text-xs font-mono font-bold ${result.success ? 'text-accent-green' : 'text-accent-red'}`}>
          {result.success ? 'IMPORT COMPLETE' : 'IMPORT FAILED'}
        </span>
        <span className="text-[10px] font-mono text-muted">
          {result.imported} imported / {result.failed} failed
        </span>
      </div>
      {result.errors.length > 0 && (
        <div className="mt-2 space-y-1">
          {result.errors.slice(0, 5).map((err, i) => (
            <p key={i} className="text-[10px] font-mono text-accent-red">{err}</p>
          ))}
          {result.errors.length > 5 && (
            <p className="text-[10px] font-mono text-muted">+ {result.errors.length - 5} more errors</p>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <TopNav onSearchOpen={() => setSearchOpen(true)} />
      <SearchCommand />

      <div className="flex-1 pt-12 pb-7 bg-background overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 md:p-6 border-b border-border shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-mono text-lg md:text-2xl tracking-[0.15em] text-foreground">
              ADMIN PANEL
            </h1>
            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded text-accent-red bg-accent-red/10 border border-accent-red/30">
              RESTRICTED
            </span>
          </div>
          <p className="text-sm text-slate-400">
            Data sync management, CSV imports, and system administration.
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 md:p-6 space-y-8">

          {/* Unmatched ATO vendor names awaiting an operator decision */}
          <AtoMatchReview />

          {/* Sync Status Cards */}
          <section>
            <h2 className="font-mono text-xs tracking-[0.2em] text-muted mb-4 uppercase">SYNC STATUS</h2>
            {syncLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-32 bg-surface rounded animate-pulse" />
                ))}
              </div>
            ) : syncStatuses.length === 0 ? (
              <div className="p-4 bg-surface border border-border rounded">
                <p className="text-sm text-muted font-mono">No sync sources configured. Run initial data sync to populate.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {syncStatuses.map((sync) => (
                  <div key={sync.id} className="bg-surface border border-border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono tracking-wider text-foreground">{sync.source.toUpperCase()}</span>
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${syncStatusBadge(sync.status)}`}>
                        {sync.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[10px] font-mono text-muted">LAST SYNC</span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {sync.lastSyncAt ? formatDateTime(sync.lastSyncAt) : 'NEVER'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] font-mono text-muted">ADDED</span>
                        <span className="text-[10px] font-mono text-accent-green">{sync.recordsAdded}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] font-mono text-muted">UPDATED</span>
                        <span className="text-[10px] font-mono text-accent-blue">{sync.recordsUpdated}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] font-mono text-muted">FAILED</span>
                        <span className={`text-[10px] font-mono ${sync.recordsFailed > 0 ? 'text-accent-red' : 'text-muted'}`}>
                          {sync.recordsFailed}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => triggerSync(sync.source)}
                      disabled={syncingSource === sync.source}
                      className="w-full px-3 py-1.5 text-[10px] font-mono tracking-wider text-accent-blue border border-accent-blue/30 rounded hover:bg-accent-blue/10 hover:border-accent-blue/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {syncingSource === sync.source ? 'SYNCING...' : 'SYNC NOW'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Record Counts */}
          <section>
            <h2 className="font-mono text-xs tracking-[0.2em] text-muted mb-4 uppercase">RECORD COUNTS</h2>
            {Object.keys(recordCounts).length === 0 ? (
              <div className="p-4 bg-surface border border-border rounded">
                <p className="text-sm text-muted font-mono">No record counts available.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {Object.entries(recordCounts).map(([table, count]) => (
                  <div key={table} className="bg-surface border border-border rounded-lg p-3 text-center">
                    <span className="font-mono text-lg text-accent-blue">{count.toLocaleString()}</span>
                    <p className="text-[9px] font-mono text-muted tracking-wider mt-1 uppercase">{table.replace(/_/g, ' ')}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* eMASS CSV Import */}
          <section>
            <h2 className="font-mono text-xs tracking-[0.2em] text-muted mb-4 uppercase">eMASS CSV IMPORT</h2>
            <div className="bg-surface border border-border rounded-lg p-4 space-y-4">
              {renderDropZone(
                'Upload eMASS CSV Export',
                emassFile,
                emassInputRef,
                (f) => handleFileUpload(f, setEmassFile, setEmassPreview, setEmassMapping, EMASS_FIELDS),
                'accent-gold'
              )}

              {emassPreview && (
                <>
                  <div>
                    <span className="text-[10px] font-mono text-muted tracking-wider">PREVIEW (FIRST 10 ROWS)</span>
                    {renderPreviewTable(emassPreview)}
                  </div>
                  <div>
                    <span className="text-[10px] font-mono text-muted tracking-wider">COLUMN MAPPING</span>
                    {renderMappingControls(emassPreview, emassMapping, setEmassMapping, EMASS_FIELDS)}
                  </div>
                  <button
                    onClick={importEmass}
                    disabled={emassImporting}
                    className="px-4 py-2 text-xs font-mono tracking-wider text-accent-gold border border-accent-gold/30 rounded hover:bg-accent-gold/10 hover:border-accent-gold/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {emassImporting ? 'IMPORTING...' : 'IMPORT eMASS DATA'}
                  </button>
                </>
              )}

              {emassResult && renderImportResult(emassResult)}
            </div>
          </section>

          {/* DISA PA CSV Import */}
          <section>
            <h2 className="font-mono text-xs tracking-[0.2em] text-muted mb-4 uppercase">DISA PA CSV IMPORT</h2>
            <div className="bg-surface border border-border rounded-lg p-4 space-y-4">
              {renderDropZone(
                'Upload DISA PA CSV Export',
                disaFile,
                disaInputRef,
                (f) => handleFileUpload(f, setDisaFile, setDisaPreview, setDisaMapping, DISA_FIELDS),
                'accent-blue'
              )}

              {disaPreview && (
                <>
                  <div>
                    <span className="text-[10px] font-mono text-muted tracking-wider">PREVIEW (FIRST 10 ROWS)</span>
                    {renderPreviewTable(disaPreview)}
                  </div>
                  <div>
                    <span className="text-[10px] font-mono text-muted tracking-wider">COLUMN MAPPING</span>
                    {renderMappingControls(disaPreview, disaMapping, setDisaMapping, DISA_FIELDS)}
                  </div>
                  <button
                    onClick={importDisa}
                    disabled={disaImporting}
                    className="px-4 py-2 text-xs font-mono tracking-wider text-accent-blue border border-accent-blue/30 rounded hover:bg-accent-blue/10 hover:border-accent-blue/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {disaImporting ? 'IMPORTING...' : 'IMPORT DISA PA DATA'}
                  </button>
                </>
              )}

              {disaResult && renderImportResult(disaResult)}
            </div>
          </section>

          {/* Seed Data */}
          <section>
            <h2 className="font-mono text-xs tracking-[0.2em] text-muted mb-4 uppercase">DATA SEEDING</h2>
            <div className="bg-surface border border-border rounded-lg p-4 space-y-4">
              <p className="text-xs text-muted-foreground">
                Seed known DISA PA data from built-in dataset. This will create initial DoD Provisional Authorization records.
              </p>
              <div className="flex items-center gap-4">
                <button
                  onClick={seedDisa}
                  disabled={seeding}
                  className="px-4 py-2 text-xs font-mono tracking-wider text-accent-green border border-accent-green/30 rounded hover:bg-accent-green/10 hover:border-accent-green/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {seeding ? 'SEEDING...' : 'SEED DISA PA DATA'}
                </button>
                {seedResult && (
                  <span className="text-[10px] font-mono text-muted-foreground">{seedResult}</span>
                )}
              </div>
            </div>
          </section>

          {/* Data Source footer */}
          <div className="text-[9px] font-mono text-muted tracking-wider pb-4">
            ADMIN PANEL — <span className="text-accent-red">QUAESTRON</span> — AUTHORIZED PERSONNEL ONLY
          </div>
        </div>
      </div>

      <BottomBar />
    </div>
  )
}
