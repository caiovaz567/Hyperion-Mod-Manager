import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  IPC,
  type AppGeneralLogEntry,
  type AppLogsSnapshot,
  type AppLogsUpdate,
  type IpcResult,
  type NexusApiLogEntry,
} from '@shared/types'
import { IpcService } from '../../services/IpcService'
import { useAppStore } from '../../store/useAppStore'
import { formatWindowsDateTime } from '../../utils/dateFormat'
import { Tooltip } from './Tooltip'

interface AppLogsDialogProps {
  onClose: () => void
}

type LogsTab = 'general' | 'requests'
const APP_LOGS_CONTENT_GUTTER_PX = 24

interface LoggedSecretValue {
  __hyperionSecret: true
  masked: string
  value: string
}

const requestMethodBadgeClass: Record<NexusApiLogEntry['method'], string> = {
  GET: 'border-[#4a3f08] bg-[#171303] text-[#fcee09]',
  POST: 'border-[#14365a] bg-[#07111d] text-[#60a5fa]',
  PUT: 'border-[#114038] bg-[#061512] text-[#34d399]',
  PATCH: 'border-[#4b2f11] bg-[#1a1006] text-[#fb923c]',
  DELETE: 'border-[#4a1212] bg-[#150404] text-[#f87171]',
}

const generalLevelBadgeClass: Record<AppGeneralLogEntry['level'], string> = {
  info: 'border-[#2a2a2a] bg-[#111] text-[#d0d0d0]',
  warn: 'border-[#4a3f08] bg-[#171303] text-[#fcee09]',
  error: 'border-[#4a1212] bg-[#150404] text-[#f87171]',
}

const tabButtonClass = (active: boolean) =>
  `min-w-[118px] rounded-sm px-4 py-2.5 text-center transition-colors ${
    active
      ? 'bg-[#120f03] text-[#fcee09]'
      : 'bg-transparent text-[#9c9c9c] hover:bg-[#0d0d0d] hover:text-[#d9d9d9]'
  }`

const inlineBadgeClass = 'inline-flex h-5 items-center rounded-sm border-[0.5px] px-2 text-[10px] font-mono uppercase tracking-[0.14em]'

const logRowSurfaceClass = (active: boolean) =>
  `overflow-hidden rounded-sm border-[0.5px] transition-[border-color,box-shadow,background-color] ${
    active
      ? 'border-[#6a5b10] bg-[#0b0a04] shadow-[0_0_0_1px_rgba(252,238,9,0.08)]'
      : 'border-[#1a1a1a] bg-[#080808] hover:border-[#3b3512] hover:bg-[#0f0e08]'
  }`

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs)) return '--'
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(2)} s`
}

function formatStatusCode(entry: NexusApiLogEntry): string {
  if (entry.statusCode) return String(entry.statusCode)
  return entry.status === 'success' ? 'OK' : 'ERR'
}

function isLoggedSecretValue(value: unknown): value is LoggedSecretValue {
  return Boolean(
    value &&
    typeof value === 'object' &&
    '__hyperionSecret' in (value as Record<string, unknown>) &&
    'masked' in (value as Record<string, unknown>) &&
    'value' in (value as Record<string, unknown>)
  )
}

function getPayloadKindLabel(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`
  if (value === null) return 'null'
  if (isLoggedSecretValue(value)) return 'secret'
  if (typeof value === 'object') return `object(${Object.keys(value as Record<string, unknown>).length})`
  return typeof value
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function resolveSecrets(value: unknown, revealSecrets: boolean): unknown {
  if (isLoggedSecretValue(value)) {
    return revealSecrets ? value.value : value.masked
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveSecrets(item, revealSecrets))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, innerValue]) => [key, resolveSecrets(innerValue, revealSecrets)])
    )
  }
  return value
}

function stringifyPayload(value: unknown, revealSecrets: boolean): string {
  try {
    return JSON.stringify(resolveSecrets(value ?? null, revealSecrets), null, 2)
  } catch {
    return String(value)
  }
}

function getPrimitiveClassName(value: unknown): string {
  if (typeof value === 'string') return 'text-[#f1df88]'
  if (typeof value === 'number') return 'text-[#60a5fa]'
  if (typeof value === 'boolean') return 'text-[#34d399]'
  return 'text-[#8a8a8a]'
}

function formatPrimitiveLabel(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return `"${value}"`
  return String(value)
}

function buildInlinePreview(value: unknown, revealSecrets: boolean, depth = 0): string {
  if (isLoggedSecretValue(value)) return `"${revealSecrets ? value.value : value.masked}"`
  if (isPayloadPrimitive(value)) return formatPrimitiveLabel(value)
  if (depth >= 1) {
    if (Array.isArray(value)) return `Array(${value.length})`
    return `Object(${Object.keys(value as Record<string, unknown>).length})`
  }
  if (Array.isArray(value)) {
    const preview = value.slice(0, 3).map((item) => buildInlinePreview(item, revealSecrets, depth + 1)).join(', ')
    return `${preview}${value.length > 3 ? ', ...' : ''}`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  const preview = entries
    .slice(0, 3)
    .map(([key, entryValue]) => `${key}: ${buildInlinePreview(entryValue, revealSecrets, depth + 1)}`)
    .join(', ')
  return `${preview}${entries.length > 3 ? ', ...' : ''}`
}

function payloadHasSecrets(value: unknown): boolean {
  if (isLoggedSecretValue(value)) return true
  if (Array.isArray(value)) return value.some((item) => payloadHasSecrets(item))
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => payloadHasSecrets(item))
  }
  return false
}

function hasStructuredValue(value: unknown): boolean {
  return value !== null && value !== undefined
}

const StructuredDataPanel: React.FC<{
  title: string
  value: unknown
  emptyLabel: string
  revealSecrets: boolean
  onToggleRevealSecrets: () => void
  onCopy: (value: unknown, label: string) => Promise<void>
  icon?: string
  defaultExpanded?: boolean
}> = ({
  title,
  value,
  emptyLabel,
  revealSecrets,
  onToggleRevealSecrets,
  onCopy,
  icon = 'data_object',
  defaultExpanded = true,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const hasSecrets = payloadHasSecrets(value)

  return (
    <div className={`overflow-hidden rounded-sm border-[0.5px] transition-[border-color,box-shadow,background-color] ${
      expanded
        ? 'border-[#6a5b10] bg-[#0b0a04] shadow-[0_0_0_1px_rgba(252,238,9,0.08)]'
        : 'border-[#1a1a1a] bg-[#080808] hover:border-[#3b3512]'
    }`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((current) => !current)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded((c) => !c) }}
        className={`flex items-center justify-between gap-3 px-3 py-2 transition-[border-color,background-color] ${expanded ? 'bg-[#111007]' : 'bg-[#080808] hover:border-[#3b3512] hover:bg-[#131109]'}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1 pl-1 pr-2 text-left">
          <span className={`material-symbols-outlined text-[16px] text-[#8a8a8a] transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`}>
            expand_more
          </span>
          <span className={`material-symbols-outlined text-[15px] text-[#fcee09]`}>{icon}</span>
          <span className="ui-support-mono uppercase tracking-[0.14em]">{title}</span>
          <span className="ui-support-mono text-[#7e8692]">{getPayloadKindLabel(value)}</span>
        </div>
        <div className="flex items-center gap-2">
          {hasSecrets ? (
            <Tooltip content={revealSecrets ? 'Hide secrets' : 'Reveal secrets'}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleRevealSecrets() }}
                className={`flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] transition-colors ${
                  revealSecrets
                    ? 'border-[#6a5b10] bg-[#151202] text-[#fcee09] hover:border-[#fcee09] hover:text-white'
                    : 'border-[#232323] bg-[#111111] text-[#a8a8a8] hover:border-[#fcee09]/40 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{revealSecrets ? 'visibility_off' : 'visibility'}</span>
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content={`Copy ${title.toLowerCase()}`}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void onCopy(value, title) }}
              className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] border-[#232323] bg-[#111111] text-[#a8a8a8] transition-colors hover:border-[#fcee09]/40 hover:text-white"
            >
              <span className="material-symbols-outlined text-[16px]">content_copy</span>
            </button>
          </Tooltip>
        </div>
      </div>
      {expanded ? (
        value === null || value === undefined ? (
          <div className="ui-support-mono px-3 py-3 uppercase tracking-[0.14em] text-[#7f7f7f]">{emptyLabel}</div>
          ) : (
          <div className="bg-[#060606] px-2 py-2">
            <PayloadNode value={value} revealSecrets={revealSecrets} />
          </div>
        )
      ) : null}
    </div>
  )
}

const PayloadNode: React.FC<{
  name?: string
  value: unknown
  revealSecrets: boolean
  depth?: number
  defaultExpanded?: boolean
  isLast?: boolean
}> = ({ name, value, revealSecrets, depth = 0, defaultExpanded = true, isLast = true }) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isRoot = name === undefined
  const isArrayIdx = /^\[\d+\]$/.test(name ?? '')
  // Each depth level adds 16px; root rows start at 8px, children at 8 + depth*16
  const rowPl = depth * 16 + 8

  // Key label: array indices unquoted, object keys quoted
  const KeyEl = !isRoot ? (
    <span className="shrink-0 font-mono">
      <span className="text-[#9cacbc]">{isArrayIdx ? name : `"${name}"`}</span>
      <span className="text-[#6f6f6f]">: </span>
    </span>
  ) : null

  const TrailingComma = !isLast ? <span className="text-[#505050]">,</span> : null

  if (isLoggedSecretValue(value)) {
    const shown = revealSecrets ? value.value : value.masked
    return (
      <div className="ui-support-mono flex items-baseline gap-0 py-[2px] hover:bg-[#111111]" style={{ paddingLeft: rowPl }}>
        {KeyEl}
        <span className="break-all text-[#f1df88]">"{shown}"</span>
        {TrailingComma}
      </div>
    )
  }

  if (isPayloadPrimitive(value)) {
    return (
      <div className="ui-support-mono flex items-baseline gap-0 py-[2px] hover:bg-[#111111]" style={{ paddingLeft: rowPl }}>
        {KeyEl}
        <span className={`break-all ${getPrimitiveClassName(value)}`}>{formatPrimitiveLabel(value)}</span>
        {TrailingComma}
      </div>
    )
  }

  const isArray = Array.isArray(value)
  const entries = isArray
    ? (value as unknown[]).map((item, i) => [`[${i}]`, item] as [string, unknown])
    : Object.entries(value as Record<string, unknown>)
  const openBrace = isArray ? '[' : '{'
  const closeBrace = isArray ? ']' : '}'
  const toggle = () => setExpanded((c) => !c)
  const preview = buildInlinePreview(value, revealSecrets)

  // The vertical guide line is anchored at rowPl + chevronWidth (≈17px)
  const guideLeft = rowPl + 17

  return (
    <div>
      {/* Opening row — chevron + optional key + opening brace */}
      <div
        role="button"
        tabIndex={0}
        className="ui-support-mono flex cursor-pointer items-baseline gap-0 py-[2px] hover:bg-[#111111] focus:outline-none"
        style={{ paddingLeft: rowPl }}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle() }}
      >
        <span
          className={`material-symbols-outlined mr-[5px] mt-[1px] shrink-0 select-none text-[#636363] transition-transform ${expanded ? '' : '-rotate-90'}`}
          style={{ fontSize: '12px' }}
        >
          expand_more
        </span>
        {KeyEl}
        <span className="text-[#6f6f6f]">{openBrace}</span>
        {!expanded ? (
          <>
            <span className="mx-[6px] truncate text-[#7a7a7a]">{preview}</span>
            <span className="text-[#6f6f6f]">{closeBrace}</span>
            {TrailingComma}
          </>
        ) : null}
      </div>

      {expanded ? (
        <>
          {/* Children with vertical guide line */}
          <div style={{ marginLeft: guideLeft, borderLeft: '1px solid #1c1c1c' }}>
            {entries.length === 0 ? (
              <div className="ui-support-mono py-[2px] pl-2 text-[#8a8a8a]">empty</div>
            ) : (
              entries.map(([k, v], i) => (
                <PayloadNode
                  key={k}
                  name={k}
                  value={v}
                  revealSecrets={revealSecrets}
                  depth={depth + 1}
                  defaultExpanded={depth < 1}
                  isLast={i === entries.length - 1}
                />
              ))
            )}
          </div>
          {/* Closing brace aligned with opening brace character */}
          <div className="ui-support-mono py-[2px]" style={{ paddingLeft: guideLeft }}>
            <span className="text-[#6f6f6f]">{closeBrace}</span>
            {TrailingComma}
          </div>
        </>
      ) : null}
    </div>
  )
}

export const AppLogsDialog: React.FC<AppLogsDialogProps> = ({ onClose }) => {
  const addToast = useAppStore((state) => state.addToast)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<LogsTab>('general')
  const [loading, setLoading] = useState(false)
  const [revealSecrets, setRevealSecrets] = useState(false)
  const [scrollbarCompensationPx, setScrollbarCompensationPx] = useState(0)
  const [generalEntries, setGeneralEntries] = useState<AppGeneralLogEntry[]>([])
  const [requestEntries, setRequestEntries] = useState<NexusApiLogEntry[]>([])
  const [expandedGeneralIds, setExpandedGeneralIds] = useState<Set<string>>(new Set())
  const [expandedRequestIds, setExpandedRequestIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let mounted = true
    setLoading(true)

    void IpcService.invoke<IpcResult<AppLogsSnapshot>>(IPC.APP_LOGS_GET)
      .then((result) => {
        if (!mounted || !result.ok || !result.data) return
        setGeneralEntries(result.data.general)
        setRequestEntries(result.data.requests)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    const unsubscribe = IpcService.on(IPC.APP_LOGS_UPDATED, (...args) => {
      const update = args[0] as AppLogsUpdate
      if (update.kind === 'general') {
        setGeneralEntries((current) => [update.entry, ...current].slice(0, 200))
        return
      }
      setRequestEntries((current) => [update.entry, ...current].slice(0, 120))
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useLayoutEffect(() => {
    const element = scrollAreaRef.current
    if (!element) return

    const measure = () => {
      const nextValue = Math.max(0, element.offsetWidth - element.clientWidth)
      setScrollbarCompensationPx((current) => (current === nextValue ? current : nextValue))
    }

    measure()

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measure())
      : null

    resizeObserver?.observe(element)
    window.addEventListener('resize', measure)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [activeTab, generalEntries.length, requestEntries.length])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const activeCount = activeTab === 'general' ? generalEntries.length : requestEntries.length
  const clearTabLabel = activeTab === 'general' ? 'Clear General logs' : 'Clear Request logs'

  const emptyLabel = useMemo(() => {
    if (loading) return 'Loading logs...'
    return activeTab === 'general'
      ? 'No general app logs recorded yet'
      : 'No request logs recorded yet'
  }, [activeTab, loading])

  const toggleGeneral = (id: string) => {
    setExpandedGeneralIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleRequest = (id: string) => {
    setExpandedRequestIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleClearTab = async () => {
    const target = activeTab === 'general' ? 'general' : 'requests'
    await IpcService.invoke<IpcResult>(IPC.APP_LOGS_CLEAR, target)
    if (target === 'general') {
      setGeneralEntries([])
      setExpandedGeneralIds(new Set())
      return
    }
    setRequestEntries([])
    setExpandedRequestIds(new Set())
  }

  const handleCopyPayload = async (payload: unknown, label = 'Payload') => {
    try {
      await navigator.clipboard.writeText(stringifyPayload(payload, revealSecrets))
      addToast(
        revealSecrets ? `${label} copied with secrets shown` : `${label} copied`,
        'success',
        1800
      )
    } catch {
      addToast(`Could not copy ${label.toLowerCase()}`, 'error', 2200)
    }
  }

  const toggleRevealSecrets = () => {
    setRevealSecrets((current) => !current)
  }

  const renderRequestEntry = (entry: NexusApiLogEntry, previewLabel?: string) => {
    const expanded = expandedRequestIds.has(entry.id)
    const resolvedResponseBody =
      entry.responseBody ?? (entry.method === 'GET' ? entry.payload : undefined)

    return (
      <div key={entry.id} className={logRowSurfaceClass(expanded)}>
        <button
          type="button"
          onClick={() => toggleRequest(entry.id)}
          className={`grid w-full grid-cols-[150px_76px_minmax(0,1fr)_76px_86px_20px] items-center gap-3 px-6 py-3 text-left transition-colors ${
            expanded ? 'bg-[#111007]' : 'hover:bg-[#131109]'
          }`}
        >
          <span className="ui-support-mono">{formatWindowsDateTime(entry.timestamp)}</span>
          <span className={`${inlineBadgeClass} justify-center ${requestMethodBadgeClass[entry.method]}`}>{entry.method}</span>
          <span className="min-w-0">
            <span className="mb-1 flex items-center gap-2">
              <span className="block truncate font-mono text-sm text-[#e5e2e1]">{entry.endpoint}</span>
              {previewLabel ? (
                <span className="inline-flex h-5 shrink-0 items-center rounded-sm border-[0.5px] border-[#2b2b2b] bg-[#111111] px-2 text-[10px] font-mono uppercase tracking-[0.14em] text-[#d6d6d6]">
                  {previewLabel}
                </span>
              ) : null}
            </span>
            <span className="ui-support-mono block truncate">{entry.url}</span>
          </span>
          <span className={`${inlineBadgeClass} justify-center ${
            entry.status === 'success'
              ? 'border-[#1d3d2e] bg-[#091410] text-[#34d399]'
              : 'border-[#4a1212] bg-[#150404] text-[#f87171]'
          }`}>
            {formatStatusCode(entry)}
          </span>
          <span className="ui-support-mono truncate text-[#cfcfcf]">{formatDuration(entry.durationMs)}</span>
          <span className={`material-symbols-outlined text-[16px] text-[#8a8a8a] transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`}>
            expand_more
          </span>
        </button>
        {expanded ? (
          <div className="border-t-[0.5px] border-[#1a1a1a] bg-[#060606] px-6 py-4">
            {previewLabel ? (
              <div className="mb-4 overflow-hidden rounded-sm border-[0.5px] border-[#2a2a2a] bg-[#090909] px-3 py-3">
                <div className="ui-support-mono mb-1 uppercase tracking-[0.14em] text-[#d6d6d6]">Preview</div>
                <div className="font-mono text-sm text-[#b8b8b8]">
                  Mock POST example to preview how sent payload and received response are rendered in the inspector.
                </div>
              </div>
            ) : null}
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <div className="overflow-hidden rounded-sm border-[0.5px] border-[#1a1a1a] bg-[#080808] px-3 py-3">
                <div className="ui-support-mono mb-1 uppercase tracking-[0.14em]">Method</div>
                <span className={`${inlineBadgeClass} ${requestMethodBadgeClass[entry.method]}`}>{entry.method}</span>
              </div>
              <div className="overflow-hidden rounded-sm border-[0.5px] border-[#1a1a1a] bg-[#080808] px-3 py-3">
                <div className="ui-support-mono mb-1 uppercase tracking-[0.14em]">Endpoint</div>
                <div className="font-mono text-sm text-[#e5e2e1] break-all">{entry.endpoint}</div>
              </div>
              <div className="overflow-hidden rounded-sm border-[0.5px] border-[#1a1a1a] bg-[#080808] px-3 py-3">
                <div className="ui-support-mono mb-1 uppercase tracking-[0.14em]">Status</div>
                <div className="font-mono text-sm text-[#e5e2e1]">{formatStatusCode(entry)}</div>
              </div>
              <div className="overflow-hidden rounded-sm border-[0.5px] border-[#1a1a1a] bg-[#080808] px-3 py-3">
                <div className="ui-support-mono mb-1 uppercase tracking-[0.14em]">API Time</div>
                <div className="font-mono text-sm text-[#e5e2e1]">{formatDuration(entry.durationMs)}</div>
              </div>
            </div>
            <div className="mb-4 overflow-hidden rounded-sm border-[0.5px] border-[#1a1a1a] bg-[#070707]">
              <div className="flex items-center gap-2 border-b-[0.5px] border-[#161616] bg-[#0b0b0b] px-3 py-2">
                <span className="material-symbols-outlined text-[15px] text-[#fcee09]">link</span>
                <span className="ui-support-mono uppercase tracking-[0.14em]">Request URL</span>
              </div>
              <div className="px-3 py-3 font-mono text-sm text-[#e5e2e1] break-all">
                {entry.url}
              </div>
            </div>
            {entry.error ? (
              <div className="mb-4 overflow-hidden rounded-sm border-[0.5px] border-[#4a1212] bg-[#120707]">
                <div className="flex items-center gap-2 border-b-[0.5px] border-[#341010] bg-[#180909] px-3 py-2">
                  <span className="material-symbols-outlined text-[15px] text-[#f87171]">error</span>
                  <span className="ui-support-mono uppercase tracking-[0.14em] text-[#fca5a5]">Error</span>
                </div>
                <div className="px-3 py-3 font-mono text-sm text-[#fca5a5]">
                  {entry.error}
                </div>
              </div>
            ) : null}
            <div className="space-y-4">
              {hasStructuredValue(entry.requestBody) ? (
                <StructuredDataPanel
                  title="Request Body"
                  value={entry.requestBody}
                  emptyLabel="No request body"
                  revealSecrets={revealSecrets}
                  onToggleRevealSecrets={toggleRevealSecrets}
                  onCopy={handleCopyPayload}
                  icon="upload"
                  defaultExpanded={false}
                />
              ) : null}
              {hasStructuredValue(resolvedResponseBody) ? (
                <StructuredDataPanel
                  title="Response Body"
                  value={resolvedResponseBody}
                  emptyLabel="No response body captured"
                  revealSecrets={revealSecrets}
                  onToggleRevealSecrets={toggleRevealSecrets}
                  onCopy={handleCopyPayload}
                  icon="download"
                  defaultExpanded={false}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <div className="relative flex h-[88vh] w-[min(94vw,1760px)] max-w-none flex-col overflow-hidden border-[0.5px] border-[#222] bg-[#050505] shadow-[0_22px_60px_rgba(0,0,0,0.82)]">
        <div className="absolute left-0 top-0 h-[2px] w-full bg-[#fcee09] shadow-[0_0_14px_rgba(252,238,9,0.38)]" />

        <div className="flex items-start justify-between gap-6 border-b-[0.5px] border-[#1a1a1a] px-6 py-5">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <span className="material-symbols-outlined text-[20px] text-[#fcee09]">terminal</span>
              <h2 className="brand-font text-[1.15rem] font-bold uppercase tracking-[0.12em] text-white">
                App Logs
              </h2>
              <span className={`${inlineBadgeClass} border-[#4a3f08] bg-[#171303] text-[#fcee09]`}>
                live
              </span>
            </div>
            <p className="ui-support-mono max-w-3xl">
              Diagnostic events and Nexus API requests are grouped here. Click a row to inspect structured details or request payloads.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Tooltip content="Close logs">
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] border-[#222] bg-[#0a0a0a] text-[#9a9a9a] transition-colors hover:border-[#fcee09]/40 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </Tooltip>
          </div>
        </div>

        <div
          className="border-b-[0.5px] border-[#1a1a1a] py-3"
          style={{
            paddingLeft: `${APP_LOGS_CONTENT_GUTTER_PX}px`,
            paddingRight: `${APP_LOGS_CONTENT_GUTTER_PX}px`,
          }}
        >
          <div className="flex items-center justify-between gap-6">
            <div className="inline-flex shrink-0 flex-wrap items-center gap-1 border-[0.5px] border-[#1a1a1a] bg-[#070707] p-1">
              <button type="button" onClick={() => setActiveTab('general')} className={tabButtonClass(activeTab === 'general')}>
                <span className="brand-font text-[0.88rem] font-bold uppercase tracking-[0.12em]">General</span>
                <span className="ml-2 brand-font text-[0.88rem] font-bold uppercase tracking-[0.12em] text-inherit/85">
                  {generalEntries.length}
                </span>
              </button>
              <button type="button" onClick={() => setActiveTab('requests')} className={tabButtonClass(activeTab === 'requests')}>
                <span className="brand-font text-[0.88rem] font-bold uppercase tracking-[0.12em]">Requests</span>
                <span className="ml-2 brand-font text-[0.88rem] font-bold uppercase tracking-[0.12em] text-inherit/85">
                  {requestEntries.length}
                </span>
              </button>
            </div>
            <div className="flex min-w-0 items-center justify-end gap-2">
              <div className="ui-support-mono shrink-0 uppercase tracking-[0.14em]">
                {activeCount} entr{activeCount === 1 ? 'y' : 'ies'}
              </div>
              <Tooltip content={clearTabLabel}>
                <button
                  type="button"
                  aria-label={clearTabLabel}
                  onClick={() => void handleClearTab()}
                  className="flex h-[46px] min-w-[50px] items-center justify-center rounded-sm border-[0.5px] border-[#3a1010] bg-[#0d0404] text-[#f18d8d] transition-colors hover:border-[#f87171] hover:bg-[#1a0505] hover:text-[#ffe1e1]"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '24px', fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}
                  >
                    delete
                  </span>
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        <div
          ref={scrollAreaRef}
          className="hyperion-scrollbar flex-1 overflow-y-auto py-5"
          style={{
            scrollbarGutter: 'stable',
            paddingLeft: `${APP_LOGS_CONTENT_GUTTER_PX}px`,
            paddingRight: `${Math.max(0, APP_LOGS_CONTENT_GUTTER_PX - scrollbarCompensationPx)}px`,
          }}
        >
          {activeTab === 'general' ? (
            generalEntries.length === 0 ? (
              <div className="flex h-full min-h-[260px] items-center justify-center border-[0.5px] border-[#1a1a1a] bg-[#070707]">
                <div className="ui-support-mono text-center uppercase tracking-[0.14em]">{emptyLabel}</div>
              </div>
            ) : (
              <div className="space-y-2">
                {generalEntries.map((entry) => {
                  const expanded = expandedGeneralIds.has(entry.id)
                  return (
                    <div key={entry.id} className={logRowSurfaceClass(expanded)}>
                      <button
                        type="button"
                        onClick={() => toggleGeneral(entry.id)}
                        className={`grid w-full grid-cols-[150px_92px_120px_minmax(0,1fr)_20px] items-center gap-3 px-6 py-3 text-left transition-colors ${
                          expanded ? 'bg-[#111007]' : 'hover:bg-[#131109]'
                        }`}
                      >
                        <span className="ui-support-mono">{formatWindowsDateTime(entry.timestamp)}</span>
                        <span className={`${inlineBadgeClass} ${generalLevelBadgeClass[entry.level]}`}>{entry.level}</span>
                        <span className="ui-support-mono truncate uppercase tracking-[0.14em] text-[#cfcfcf]">{entry.source}</span>
                        <span className="ui-support-mono truncate text-[#e5e2e1]">{entry.message}</span>
                        <span className={`material-symbols-outlined text-[16px] text-[#8a8a8a] transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`}>
                          expand_more
                        </span>
                      </button>
                      {expanded ? (
                        <div className="border-t-[0.5px] border-[#1a1a1a] bg-[#060606] px-4 py-4">
                          <div className="mb-4 grid gap-3 md:grid-cols-3">
                            <div className="border-[0.5px] border-[#1a1a1a] bg-[#080808] px-3 py-3">
                              <div className="ui-support-mono mb-1 uppercase tracking-[0.14em]">Source</div>
                              <div className="font-mono text-sm text-[#e5e2e1]">{entry.source}</div>
                            </div>
                            <div className="border-[0.5px] border-[#1a1a1a] bg-[#080808] px-3 py-3">
                              <div className="ui-support-mono mb-1 uppercase tracking-[0.14em]">Level</div>
                              <div className="font-mono text-sm uppercase tracking-[0.08em] text-[#e5e2e1]">{entry.level}</div>
                            </div>
                            <div className="border-[0.5px] border-[#1a1a1a] bg-[#080808] px-3 py-3">
                              <div className="ui-support-mono mb-1 uppercase tracking-[0.14em]">Occurred</div>
                              <div className="font-mono text-sm text-[#e5e2e1]">{formatWindowsDateTime(entry.timestamp)}</div>
                            </div>
                          </div>
                          <StructuredDataPanel
                            title="Details"
                            value={entry.details}
                            emptyLabel="No structured details"
                            revealSecrets={revealSecrets}
                            onToggleRevealSecrets={toggleRevealSecrets}
                            onCopy={handleCopyPayload}
                            icon="data_object"
                            defaultExpanded={false}
                          />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )
          ) : (
            <div className="space-y-2">
              {requestEntries.length === 0 ? (
                <div className="flex min-h-[180px] items-center justify-center border-[0.5px] border-[#1a1a1a] bg-[#070707]">
                  <div className="ui-support-mono text-center uppercase tracking-[0.14em]">No live request logs recorded yet</div>
                </div>
              ) : (
                requestEntries.map((entry) => renderRequestEntry(entry))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
