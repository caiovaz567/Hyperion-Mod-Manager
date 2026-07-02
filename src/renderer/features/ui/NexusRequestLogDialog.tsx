import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseButton } from '@heroui/react'
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
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from './Icon'
import { UnderlineTabs } from './uiKit'

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

// Soft filled chips (no harsh outline) — semantic per HTTP method / log level.
const requestMethodBadgeClass: Record<NexusApiLogEntry['method'], string> = {
  GET: 'bg-[rgb(252_238_9/0.14)] text-[#fcee09]',
  POST: 'bg-[rgb(96_165_250/0.16)] text-[#60a5fa]',
  PUT: 'bg-[rgb(52_211_153/0.16)] text-[#34d399]',
  PATCH: 'bg-[rgb(251_146_60/0.16)] text-[#fb923c]',
  DELETE: 'bg-[rgb(248_113_113/0.16)] text-[#f87171]',
}

const generalLevelBadgeClass: Record<AppGeneralLogEntry['level'], string> = {
  info: 'bg-[var(--surface-secondary)] text-[var(--text-secondary)]',
  warn: 'bg-[rgb(252_238_9/0.14)] text-[#fcee09]',
  error: 'bg-[rgb(248_113_113/0.16)] text-[#f87171]',
}

const inlineBadgeClass = 'inline-flex h-5 items-center rounded-md px-2 text-[10px] font-mono uppercase tracking-[0.14em]'

const logRowSurfaceClass = (active: boolean) =>
  `overflow-hidden rounded-xl transition-[box-shadow,background-color] ${
    active
      ? 'bg-[rgb(var(--accent-rgb)/0.08)] shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/0.45)]'
      : 'bg-[var(--surface)] hover:bg-[var(--surface-secondary)]'
  }`

// Readable HeroUI-style section label (replaces the old faded micro-uppercase mono labels).
const metaLabelClass = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]'

// Small stat card used in the expanded request detail (Method / Endpoint / Status / API time).
const MetaCard: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="rounded-xl bg-[var(--surface-secondary)] px-4 py-3">
    <div className={`${metaLabelClass} mb-1.5`}>{label}</div>
    {children}
  </div>
)

// Labeled panel (Request URL / Error / structured payloads) — soft rounded surface, readable header.
const LabeledPanel: React.FC<{
  icon: string
  label: string
  tone?: 'default' | 'error'
  headerRight?: React.ReactNode
  children: React.ReactNode
}> = ({ icon, label, tone = 'default', headerRight, children }) => {
  const isError = tone === 'error'
  return (
    <div className={`overflow-hidden rounded-xl ${isError ? 'bg-[rgb(248_113_113/0.06)]' : 'bg-[var(--surface-secondary)]'}`}>
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon name={icon} className={`text-[16px] ${isError ? 'text-[var(--status-error)]' : 'text-[var(--accent)]'}`} />
          <span className={`${metaLabelClass} ${isError ? 'text-[#fca5a5]' : ''}`}>{label}</span>
        </div>
        {headerRight}
      </div>
      {children}
    </div>
  )
}

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
  // Strings use a fixed, readable warm tone (not the accent — a low-opacity blue/etc. accent
  // reads too dark on the code surface). Numbers/booleans/null keep their semantic colors.
  if (typeof value === 'string') return 'text-[#e0af68]'
  if (typeof value === 'number') return 'text-[#7aa2f7]'
  if (typeof value === 'boolean') return 'text-[#9ece6a]'
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
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const hasSecrets = payloadHasSecrets(value)

  return (
    <div className="overflow-hidden rounded-xl bg-[var(--surface-secondary)]">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((current) => !current)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded((c) => !c) }}
        className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-[rgb(255_255_255/0.02)]"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <Icon name="expand_more" className={`text-[16px] text-[var(--text-muted)] transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`} />
          <Icon name={icon} className="text-[16px] text-[var(--accent)]" />
          <span className={metaLabelClass}>{title}</span>
          <span className="text-[11px] font-medium text-[var(--text-disabled)]">{getPayloadKindLabel(value)}</span>
        </div>
        <div className="flex items-center gap-2">
          {hasSecrets ? (
            <Tooltip content={revealSecrets ? t('logs.hideSecrets') : t('logs.revealSecrets')}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleRevealSecrets() }}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border-0 transition-colors ${
                  revealSecrets
                    ? 'bg-[rgb(var(--accent-rgb)/0.14)] text-[var(--accent)] hover:bg-[rgb(var(--accent-rgb)/0.22)]'
                    : 'bg-[var(--surface)] text-[var(--text-support)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon name={revealSecrets ? 'visibility_off' : 'visibility'} className="text-[16px]" />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content={t('logs.copyTitle', { title: title.toLowerCase() })}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void onCopy(value, title) }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-[var(--surface)] text-[var(--text-support)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
            >
              <Icon name="content_copy" className="text-[16px]" />
            </button>
          </Tooltip>
        </div>
      </div>
      {expanded ? (
        value === null || value === undefined ? (
          <div className="px-4 py-3 text-[13px] text-[var(--text-muted)]">{emptyLabel}</div>
          ) : (
          <div className="border-t border-[var(--border)] bg-[rgb(0_0_0/0.28)] px-3 py-2.5">
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
  const { t } = useTranslation()
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
        <span className="break-all text-[#e0af68]">"{shown}"</span>
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
        <Icon name="expand_more" className={`mr-[5px] mt-[1px] shrink-0 select-none text-[#636363] transition-transform ${expanded ? '' : '-rotate-90'}`} style={{ fontSize: '12px' }} />
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
          <div style={{ marginLeft: guideLeft, borderLeft: '1px solid var(--bg-subtle)' }}>
            {entries.length === 0 ? (
              <div className="ui-support-mono py-[2px] pl-2 text-[#8a8a8a]">{t('logs.emptyNode')}</div>
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
  const { t, tn } = useTranslation()
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
  const clearTabLabel = activeTab === 'general' ? t('logs.clearGeneral') : t('logs.clearRequests')
  const logTabItems = [
    { id: 'general' as const, label: t('logs.tabGeneral'), icon: 'article', count: generalEntries.length },
    { id: 'requests' as const, label: t('logs.tabRequests'), icon: 'cloud_sync', count: requestEntries.length },
  ]

  const emptyLabel = useMemo(() => {
    if (loading) return t('logs.loading')
    return activeTab === 'general'
      ? t('logs.emptyGeneral')
      : t('logs.emptyRequests')
  }, [activeTab, loading, t])

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

  const handleCopyPayload = async (payload: unknown, label = t('logs.payload')) => {
    try {
      await navigator.clipboard.writeText(stringifyPayload(payload, revealSecrets))
      addToast(
        revealSecrets ? t('logs.copiedWithSecrets', { label }) : t('logs.copied', { label }),
        'success',
        1800
      )
    } catch {
      addToast(t('logs.copyError', { label: label.toLowerCase() }), 'error', 2200)
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
            expanded ? 'bg-[rgb(var(--accent-rgb)/0.06)]' : 'hover:bg-[rgb(var(--accent-rgb)/0.04)]'
          }`}
        >
          <span className="ui-support-mono">{formatWindowsDateTime(entry.timestamp)}</span>
          <span className={`${inlineBadgeClass} justify-center ${requestMethodBadgeClass[entry.method]}`}>{entry.method}</span>
          <span className="min-w-0">
            <span className="mb-1 flex items-center gap-2">
              <span className="block truncate font-mono text-sm text-[var(--text-primary-alt)]">{entry.endpoint}</span>
              {previewLabel ? (
                <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-[var(--surface-secondary)] px-2 text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  {previewLabel}
                </span>
              ) : null}
            </span>
            <span className="ui-support-mono block truncate">{entry.url}</span>
          </span>
          <span className={`${inlineBadgeClass} justify-center ${
            entry.status === 'success'
              ? 'bg-[rgb(52_211_153/0.16)] text-[#34d399]'
              : 'bg-[rgb(248_113_113/0.16)] text-[#f87171]'
          }`}>
            {formatStatusCode(entry)}
          </span>
          <span className="ui-support-mono truncate text-[#cfcfcf]">{formatDuration(entry.durationMs)}</span>
          <Icon name="expand_more" className={`text-[16px] text-[#8a8a8a] transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`} />
        </button>
        {expanded ? (
          <div className="border-t border-[var(--border)] px-6 py-5">
            {previewLabel ? (
              <LabeledPanel icon="visibility" label={t('logs.preview')}>
                <div className="px-4 py-3 font-mono text-[13px] text-[var(--text-secondary)]">
                  {t('logs.previewMock')}
                </div>
              </LabeledPanel>
            ) : null}
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <MetaCard label={t('logs.method')}>
                <span className={`${inlineBadgeClass} ${requestMethodBadgeClass[entry.method]}`}>{entry.method}</span>
              </MetaCard>
              <MetaCard label={t('logs.endpoint')}>
                <div className="font-mono text-[13px] text-[var(--text-primary)] break-all">{entry.endpoint}</div>
              </MetaCard>
              <MetaCard label={t('logs.status')}>
                <div className="font-mono text-[13px] text-[var(--text-primary)]">{formatStatusCode(entry)}</div>
              </MetaCard>
              <MetaCard label={t('logs.apiTime')}>
                <div className="font-mono text-[13px] text-[var(--text-primary)]">{formatDuration(entry.durationMs)}</div>
              </MetaCard>
            </div>
            <div className="mb-4">
              <LabeledPanel icon="link" label={t('logs.requestUrl')}>
                <div className="px-4 pb-3 font-mono text-[13px] text-[var(--text-primary)] break-all">
                  {entry.url}
                </div>
              </LabeledPanel>
            </div>
            {entry.error ? (
              <div className="mb-4">
                <LabeledPanel icon="error" label={t('logs.error')} tone="error">
                  <div className="px-4 pb-3 font-mono text-[13px] text-[#fca5a5]">
                    {entry.error}
                  </div>
                </LabeledPanel>
              </div>
            ) : null}
            <div className="space-y-4">
              {hasStructuredValue(entry.requestBody) ? (
                <StructuredDataPanel
                  title={t('logs.requestBody')}
                  value={entry.requestBody}
                  emptyLabel={t('logs.noRequestBody')}
                  revealSecrets={revealSecrets}
                  onToggleRevealSecrets={toggleRevealSecrets}
                  onCopy={handleCopyPayload}
                  icon="upload"
                  defaultExpanded={false}
                />
              ) : null}
              {hasStructuredValue(resolvedResponseBody) ? (
                <StructuredDataPanel
                  title={t('logs.responseBody')}
                  value={resolvedResponseBody}
                  emptyLabel={t('logs.noResponseBody')}
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

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <div className="relative flex h-[88vh] w-[min(94vw,1760px)] max-w-none flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-[0_24px_70px_rgba(0,0,0,0.7)]">
        <div className="flex items-start justify-between gap-6 px-6 pt-5 pb-2">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent-rgb)/0.14)] text-[var(--accent)]">
                <Icon name="terminal" className="text-[20px]" />
              </span>
              <h2 className="text-[1.25rem] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
                {t('logs.title')}
              </h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(52_211_153/0.14)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--status-success)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success)]" />
                {t('logs.live')}
              </span>
            </div>
            <p className="max-w-3xl text-sm leading-relaxed text-[var(--text-support)]">
              {t('logs.description')}
            </p>
          </div>

          <Tooltip content={t('logs.closeLogs')}>
            <CloseButton
              aria-label={t('logs.closeLogs')}
              onPress={onClose}
              className="h-9 w-9 shrink-0 rounded-lg bg-[var(--surface)] text-[var(--text-support)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
            />
          </Tooltip>
        </div>

        <div className="flex items-end justify-between gap-6 border-b border-[var(--border)] px-6 pt-1">
          <UnderlineTabs
            items={logTabItems}
            activeId={activeTab}
            onChange={setActiveTab}
            ariaLabel={t('logs.sectionsAria')}
            withBorder={false}
          />
          <div className="flex shrink-0 items-center gap-3 pb-2">
            <span className="text-[13px] text-[var(--text-support)]">
              {tn('logs.entries', activeCount)}
            </span>
            <Tooltip content={clearTabLabel}>
              <button
                type="button"
                aria-label={clearTabLabel}
                onClick={() => void handleClearTab()}
                className="flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-[rgb(248_113_113/0.12)] text-[var(--status-error)] transition-colors hover:bg-[rgb(248_113_113/0.2)]"
              >
                <Icon name="delete" className="text-[20px] leading-none" />
              </button>
            </Tooltip>
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
              <div className="flex h-full min-h-[260px] items-center justify-center rounded-xl bg-[var(--surface)]">
                <div className="text-center text-sm text-[var(--text-muted)]">{emptyLabel}</div>
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
                          expanded ? 'bg-[rgb(var(--accent-rgb)/0.06)]' : 'hover:bg-[rgb(var(--accent-rgb)/0.04)]'
                        }`}
                      >
                        <span className="ui-support-mono">{formatWindowsDateTime(entry.timestamp)}</span>
                        <span className={`${inlineBadgeClass} ${generalLevelBadgeClass[entry.level]}`}>{entry.level}</span>
                        <span className="ui-support-mono truncate uppercase tracking-[0.14em] text-[#cfcfcf]">{entry.source}</span>
                        <span className="ui-support-mono truncate text-[var(--text-primary-alt)]">{entry.message}</span>
                        <Icon name="expand_more" className={`text-[16px] text-[#8a8a8a] transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`} />
                      </button>
                      {expanded ? (
                        <div className="border-t border-[var(--border)] px-4 py-5">
                          <div className="mb-4 grid gap-3 md:grid-cols-3">
                            <MetaCard label={t('logs.source')}>
                              <div className="font-mono text-[13px] text-[var(--text-primary)]">{entry.source}</div>
                            </MetaCard>
                            <MetaCard label={t('logs.level')}>
                              <div className="font-mono text-[13px] uppercase tracking-[0.06em] text-[var(--text-primary)]">{entry.level}</div>
                            </MetaCard>
                            <MetaCard label={t('logs.occurred')}>
                              <div className="font-mono text-[13px] text-[var(--text-primary)]">{formatWindowsDateTime(entry.timestamp)}</div>
                            </MetaCard>
                          </div>
                          <StructuredDataPanel
                            title={t('logs.details')}
                            value={entry.details}
                            emptyLabel={t('logs.noDetails')}
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
                <div className="flex min-h-[180px] items-center justify-center rounded-xl bg-[var(--surface)]">
                  <div className="text-center text-sm text-[var(--text-muted)]">{t('logs.emptyRequestsLive')}</div>
                </div>
              ) : (
                requestEntries.map((entry) => renderRequestEntry(entry))
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
