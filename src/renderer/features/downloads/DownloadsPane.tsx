import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IpcService } from '../../services/IpcService'
import type { ActiveDownload, DownloadEntry, IpcResult, ModMetadata } from '@shared/types'
import { IPC } from '@shared/types'
import { ActionPromptDialog } from '../ui/ActionPromptDialog'
import { Tooltip } from '../ui/Tooltip'
import { formatWindowsDateTime } from '../../utils/dateFormat'
import { getInstallProgressAppearance } from '../../utils/installProgressAppearance'
import { DELETE_PROGRESS_APPEARANCE, getTransientDeleteProgress } from '../../utils/deleteProgressAppearance'
import { useVirtualRows } from '../../hooks/useVirtualRows'

const DOWNLOADS_GRID_TEMPLATE =
  'minmax(580px, 4.3fr) minmax(118px, 0.74fr) minmax(112px, 0.58fr) minmax(108px, 0.52fr) minmax(140px, 0.70fr) minmax(72px, 0.28fr)'
const DOWNLOADS_GRID_TEMPLATE_WIDE =
  'minmax(692px, 5.38fr) minmax(118px, 0.70fr) minmax(112px, 0.54fr) minmax(108px, 0.48fr) minmax(160px, 0.85fr) minmax(72px, 0.28fr)'
const DOWNLOADS_GRID_TEMPLATE_FULLSCREEN =
  'minmax(692px, 5.38fr) minmax(118px, 0.70fr) minmax(112px, 0.54fr) minmax(108px, 0.48fr) minmax(120px, 0.60fr) minmax(64px, 0.22fr)'
const DOWNLOAD_ROW_HEIGHT = 56
const DOWNLOAD_VIRTUALIZATION_THRESHOLD = 120
const DOWNLOADS_SEARCH_STORAGE_KEY = 'hyperion:downloadsSearch'
const DOWNLOADS_SORT_STORAGE_KEY = 'hyperion:downloadsSort'

type DownloadListRow =
  | { kind: 'active'; key: string; orderTs: number; active: ActiveDownload }
  | { kind: 'local'; key: string; orderTs: number; entry: DownloadEntry }

type DownloadSortKey = 'name' | 'status' | 'version' | 'size' | 'downloadedAt'
type DownloadSortDirection = 'asc' | 'desc'
type DownloadRowStatus = 'downloading' | 'paused' | 'queued' | 'error' | 'installed' | 'downloaded'

type DownloadContextMenuState =
  | { kind: 'blank'; x: number; y: number }
  | { kind: 'row'; x: number; y: number; row: DownloadListRow }

const readDownloadsSearchQuery = (): string => {
  try {
    return localStorage.getItem(DOWNLOADS_SEARCH_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

const readDownloadsSortPreference = (): { key: DownloadSortKey | null; direction: DownloadSortDirection } => {
  try {
    const raw = localStorage.getItem(DOWNLOADS_SORT_STORAGE_KEY)
    if (!raw) return { key: null, direction: 'asc' }
    const parsed = JSON.parse(raw) as { key?: DownloadSortKey | null; direction?: DownloadSortDirection }
    const key = parsed.key ?? null
    const direction = parsed.direction === 'desc' ? 'desc' : 'asc'
    return {
      key: key === 'name' || key === 'status' || key === 'version' || key === 'size' || key === 'downloadedAt' ? key : null,
      direction,
    }
  } catch {
    return { key: null, direction: 'asc' }
  }
}

const compareNaturalStrings = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })

const getDownloadRowTimestamp = (row: DownloadListRow): string =>
  row.kind === 'active'
    ? row.active.startedAt
    : row.entry.downloadedAt ?? row.entry.modifiedAt

const getDownloadRowSize = (row: DownloadListRow): number =>
  row.kind === 'active'
    ? Math.max(row.active.totalBytes, row.active.downloadedBytes)
    : row.entry.size

const formatSpeed = (bps: number): string => {
  if (bps <= 0) return '—'
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

const formatSize = (bytes: number): string => {
  if (bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const formatETA = (downloaded: number, total: number, speed: number): string => {
  if (speed <= 0 || total <= 0 || downloaded >= total) return '—'
  const seconds = Math.round((total - downloaded) / speed)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const s = seconds % 60
  if (minutes < 60) return `${minutes}m ${String(s).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${hours}h ${String(m).padStart(2, '0')}m`
}

const copySuffixPattern = /\sCopy(?:\s\d+)?$/i
const isCopyVariant = (name: string): boolean => copySuffixPattern.test(name.trim())
const getInstalledTimestamp = (installedAt?: string): number => {
  if (!installedAt) return Number.POSITIVE_INFINITY
  const ts = Date.parse(installedAt)
  return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts
}
const shouldPreferReinstallTarget = (candidate: ModMetadata, current: ModMetadata): boolean => {
  const candidateIsCopy = isCopyVariant(candidate.name)
  const currentIsCopy = isCopyVariant(current.name)
  if (candidateIsCopy !== currentIsCopy) return !candidateIsCopy
  return getInstalledTimestamp(candidate.installedAt) < getInstalledTimestamp(current.installedAt)
}

export const DownloadsPane: React.FC = () => {
  const {
    settings,
    installMod,
    enableMod,
    scanMods,
    addToast,
    setActiveView,
    mods,
    openReinstallPrompt,
    gamePathValid,
    libraryPathValid,
    activeDownloads,
    localFiles,
    installing,
    installSourcePath,
    installProgress,
    installStatus,
    installCurrentFile,
    refreshLocalFiles,
    downloadsLoadedPath,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    newFiles,
    markFileAsOld,
  } = useAppStore((state) => ({
    settings: state.settings,
    installMod: state.installMod,
    enableMod: state.enableMod,
    scanMods: state.scanMods,
    addToast: state.addToast,
    setActiveView: state.setActiveView,
    mods: state.mods,
    openReinstallPrompt: state.openReinstallPrompt,
    gamePathValid: state.gamePathValid,
    libraryPathValid: state.libraryPathValid,
    activeDownloads: state.activeDownloads,
    localFiles: state.localFiles,
    installing: state.installing,
    installSourcePath: state.installSourcePath,
    installProgress: state.installProgress,
    installStatus: state.installStatus,
    installCurrentFile: state.installCurrentFile,
    refreshLocalFiles: state.refreshLocalFiles,
    downloadsLoadedPath: state.downloadsLoadedPath,
    pauseDownload: state.pauseDownload,
    resumeDownload: state.resumeDownload,
    cancelDownload: state.cancelDownload,
    newFiles: state.newFiles,
    markFileAsOld: state.markFileAsOld,
  }), shallow)

  const hasRequiredPaths = Boolean(
    settings?.gamePath?.trim() && settings?.libraryPath?.trim() && gamePathValid && libraryPathValid
  )

  const [loading, setLoading] = useState(true)
  const [pendingDeleteDownload, setPendingDeleteDownload] = useState<DownloadEntry | null>(null)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  const [deletingDownloads, setDeletingDownloads] = useState<Record<string, { startedAt: number; entry: DownloadEntry }>>({})
  const [deleteProgressTick, setDeleteProgressTick] = useState(() => Date.now())
  const [contextMenu, setContextMenu] = useState<DownloadContextMenuState | null>(null)
  const [searchQuery, setSearchQuery] = useState(() => readDownloadsSearchQuery())
  const [sortKey, setSortKey] = useState<DownloadSortKey | null>(() => readDownloadsSortPreference().key)
  const [sortDirection, setSortDirection] = useState<DownloadSortDirection>(() => readDownloadsSortPreference().direction)
  const [isWideDownloadsViewport, setIsWideDownloadsViewport] = useState(() => window.innerWidth >= 1850)
  const [isFullscreenViewport, setIsFullscreenViewport] = useState(() => {
    try {
      const tolerance = 2
      return Math.abs(window.innerWidth - (window.screen?.width ?? window.innerWidth)) <= tolerance &&
        Math.abs(window.innerHeight - (window.screen?.height ?? window.innerHeight)) <= tolerance
    } catch {
      return false
    }
  })
  const downloadsScrollRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const doRefresh = async () => {
    setLoading(true)
    await refreshLocalFiles().catch(() => undefined)
    setLoading(false)
  }

  useEffect(() => {
    const deletingPaths = Object.keys(deletingDownloads)
    if (deletingPaths.length === 0) return

    const intervalId = window.setInterval(() => {
      setDeleteProgressTick(Date.now())
    }, 120)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [deletingDownloads])

  useEffect(() => {
    const downloadPath = settings?.downloadPath ?? ''
    if (!downloadPath) {
      setLoading(false)
      return
    }

    if (downloadsLoadedPath === downloadPath) {
      setLoading(false)
      return
    }

    doRefresh().catch(() => setLoading(false))
  }, [downloadsLoadedPath, settings?.downloadPath])

  const installedBySourcePath = useMemo(() => {
    const map = new Map<string, ModMetadata>()
    for (const mod of mods) {
      if (mod.kind !== 'mod' || !mod.sourcePath) continue
      const key = mod.sourcePath.toLowerCase()
      const existing = map.get(key)
      if (!existing || shouldPreferReinstallTarget(mod, existing)) {
        map.set(key, mod)
      }
    }
    return map
  }, [mods])

  const newFilesSet = useMemo(() => new Set(newFiles.map((p) => p.toLowerCase())), [newFiles])

  useEffect(() => {
    try {
      localStorage.setItem(DOWNLOADS_SEARCH_STORAGE_KEY, searchQuery)
    } catch {
      // ignore persistence errors
    }
  }, [searchQuery])

  useEffect(() => {
    try {
      localStorage.setItem(
        DOWNLOADS_SORT_STORAGE_KEY,
        JSON.stringify({ key: sortKey, direction: sortDirection })
      )
    } catch {
      // ignore persistence errors
    }
  }, [sortDirection, sortKey])

  const getRowStatus = useCallback((row: DownloadListRow): DownloadRowStatus => {
    if (row.kind === 'active') {
      switch (row.active.status) {
        case 'paused':
          return 'paused'
        case 'queued':
          return 'queued'
        case 'error':
          return 'error'
        case 'done':
          return 'downloaded'
        case 'downloading':
        default:
          return 'downloading'
      }
    }

    return installedBySourcePath.has(row.entry.path.toLowerCase()) ? 'installed' : 'downloaded'
  }, [installedBySourcePath])

  const getStatusSortRank = useCallback((status: DownloadRowStatus): number => {
    switch (status) {
      case 'downloading':
        return 0
      case 'paused':
        return 1
      case 'queued':
        return 2
      case 'installed':
        return 3
      case 'downloaded':
        return 4
      case 'error':
      default:
        return 5
    }
  }, [])

  const handleInstall = async (entry: DownloadEntry) => {
    if (!hasRequiredPaths) {
      addToast('Set Game Path and Mod Library before installing mods', 'warning')
      setActiveView('settings')
      return
    }

    const installedMod = installedBySourcePath.get(entry.path.toLowerCase())
    if (installedMod) {
      openReinstallPrompt(installedMod)
      return
    }

    const installResult = await installMod(entry.path, {
      nexusModId: entry.nxmModId,
      nexusFileId: entry.nxmFileId,
      sourceFileName: entry.name,
      sourceVersion: entry.version,
    })
    if (!installResult.ok || !installResult.data) {
      addToast(installResult.error ?? 'Install failed', 'error')
      return
    }

    if (installResult.data.status === 'installed' && installResult.data.mod) {
      await scanMods()
      const enableResult = await enableMod(installResult.data.mod.uuid)
      if (!enableResult.ok) {
        addToast(`Installed but couldn't activate: ${enableResult.error}`, 'warning')
        return
      }
      addToast(`${installResult.data.mod.name} installed & activated`, 'success')
      return
    }

    if (installResult.data.status === 'conflict') {
      addToast('File conflicts detected during install', 'warning')
    }
  }

  const openDownloadsFolder = () => {
    if (settings?.downloadPath) {
      IpcService.invoke(IPC.OPEN_PATH, settings.downloadPath)
    }
  }

  const handleDeleteDownload = async () => {
    if (!pendingDeleteDownload) return
    const target = pendingDeleteDownload
    setPendingDeleteDownload(null)
    setDeletingDownloads((current) => ({
      ...current,
      [target.path]: {
        startedAt: Date.now(),
        entry: target,
      },
    }))

    const result = await IpcService.invoke<IpcResult>(IPC.DELETE_DOWNLOAD, target.path)
    setDeletingDownloads((current) => {
      const next = { ...current }
      delete next[target.path]
      return next
    })
    if (!result.ok) {
      addToast(result.error ?? 'Could not delete download', 'error')
      return
    }
    markFileAsOld(target.path)
    addToast(`${target.name} deleted`, 'success')
    await doRefresh()
  }

  const handleDeleteAllDownloads = async () => {
    setDeletingAll(true)
    const result = await IpcService.invoke<IpcResult<{ removed: number; failed: number }>>(
      IPC.DELETE_ALL_DOWNLOADS,
    )
    setDeletingAll(false)
    setDeleteAllOpen(false)
    if (!result.ok) {
      addToast(result.error ?? 'Could not delete downloads', 'error')
      return
    }
    for (const entry of localFiles) markFileAsOld(entry.path)
    const removed = result.data?.removed ?? 0
    const failed = result.data?.failed ?? 0
    if (removed > 0) {
      addToast(`${removed} download${removed === 1 ? '' : 's'} deleted`, 'success')
    }
    if (failed > 0) {
      addToast(`${failed} download${failed === 1 ? '' : 's'} could not be deleted`, 'warning')
    }
    await doRefresh()
  }

  const getDownloadRowPath = useCallback((row: DownloadListRow): string | null => {
    if (row.kind === 'active') {
      return row.active.savedPath?.trim() ?? null
    }

    return row.entry.path.trim() || null
  }, [])

  const handleDownloadRowContextMenu = useCallback((event: React.MouseEvent, row: DownloadListRow) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ kind: 'row', x: event.clientX, y: event.clientY, row })
  }, [])

  const handleDownloadsBlankContextMenu = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-download-row="true"]')) return

    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ kind: 'blank', x: event.clientX, y: event.clientY })
  }, [])

  const handleRefreshDownloads = useCallback(async () => {
    setContextMenu(null)
    await doRefresh()
  }, [doRefresh])

  const handleOpenDownloadsLocation = useCallback(async () => {
    if (!contextMenu || contextMenu.kind !== 'row') return

    const filePath = getDownloadRowPath(contextMenu.row)
    if (!filePath) {
      addToast('Download file is not available yet', 'warning')
      return
    }

    await IpcService.invoke(IPC.SHOW_ITEM_IN_FOLDER, filePath)
    setContextMenu(null)
  }, [addToast, contextMenu, getDownloadRowPath])

  const handleInstallContextRow = useCallback(async () => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.row.kind !== 'local') return

    setContextMenu(null)
    await handleInstall(contextMenu.row.entry)
  }, [contextMenu, handleInstall])

  const handleToggleDownloadState = useCallback(async () => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.row.kind !== 'active') return

    const download = contextMenu.row.active
    setContextMenu(null)

    if (download.status === 'paused') {
      await resumeDownload(download.id)
      return
    }

    if (download.status === 'downloading' || download.status === 'queued') {
      await pauseDownload(download.id)
      return
    }

    await cancelDownload(download.id)
  }, [cancelDownload, contextMenu, pauseDownload, resumeDownload])

  const handleCancelContextDownload = useCallback(async () => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.row.kind !== 'active') return

    setContextMenu(null)
    await cancelDownload(contextMenu.row.active.id)
  }, [cancelDownload, contextMenu])

  useEffect(() => {
    if (!contextMenu) return

    const closeMenu = () => setContextMenu(null)
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') closeMenu()
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('blur', closeMenu)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('blur', closeMenu)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return

    const menu = contextMenuRef.current
    const rect = menu.getBoundingClientRect()
    const maxX = window.innerWidth - rect.width - 8
    const maxY = window.innerHeight - rect.height - 8
    const x = Math.max(8, Math.min(contextMenu.x, maxX))
    const y = Math.max(8, Math.min(contextMenu.y, maxY))

    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
  }, [contextMenu])

  useEffect(() => {
    const updateViewportFlag = () => {
      setIsWideDownloadsViewport(window.innerWidth >= 1850)
      try {
        const tolerance = 2
        setIsFullscreenViewport(
          Math.abs(window.innerWidth - (window.screen?.width ?? window.innerWidth)) <= tolerance &&
          Math.abs(window.innerHeight - (window.screen?.height ?? window.innerHeight)) <= tolerance
        )
      } catch {
        setIsFullscreenViewport(false)
      }
    }

    updateViewportFlag()
    window.addEventListener('resize', updateViewportFlag)
    return () => window.removeEventListener('resize', updateViewportFlag)
  }, [])

  const orderedRows = useMemo<DownloadListRow[]>(() => {
    const activeRows: DownloadListRow[] = activeDownloads.map((download) => ({
      kind: 'active',
      key: `active:${download.id}`,
      orderTs: Number.isNaN(Date.parse(download.startedAt)) ? 0 : Date.parse(download.startedAt),
      active: download,
    }))

    const activeDownloadPaths = new Set(
      activeDownloads
        .filter((download) => download.status === 'downloading' || download.status === 'paused' || download.status === 'queued')
        .map((download) => download.savedPath?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value))
    )

    const localRows: DownloadListRow[] = localFiles
      .filter((entry) => !activeDownloadPaths.has(entry.path.trim().toLowerCase()))
      .map((entry) => {
      const orderSource = entry.downloadedAt ?? entry.modifiedAt
      const orderTs = Date.parse(orderSource)
      const modifiedAtTs = Date.parse(entry.modifiedAt)

      return {
        kind: 'local',
        key: `local:${entry.path}`,
        orderTs: Number.isNaN(orderTs) ? (Number.isNaN(modifiedAtTs) ? 0 : modifiedAtTs) : orderTs,
        entry,
      }
    })

    return [...activeRows, ...localRows].sort((left, right) => {
      if (right.orderTs !== left.orderTs) return right.orderTs - left.orderTs
      if (left.kind !== right.kind) return left.kind === 'active' ? -1 : 1
      return left.key.localeCompare(right.key)
    })
  }, [activeDownloads, localFiles])

  const filteredRows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) return orderedRows

    return orderedRows.filter((row) => {
      const searchableText = row.kind === 'active'
        ? `${row.active.fileName} ${row.active.savedPath ?? ''}`
        : `${row.entry.name} ${row.entry.version ?? ''} ${row.entry.path}`
      return searchableText.toLowerCase().includes(normalizedQuery)
    })
  }, [orderedRows, searchQuery])

  const sortedRows = useMemo(() => {
    if (sortKey === null) return filteredRows

    const sorted = [...filteredRows].sort((left, right) => {
      if (sortKey === 'name') {
        const leftName = left.kind === 'active' ? left.active.fileName : left.entry.name
        const rightName = right.kind === 'active' ? right.active.fileName : right.entry.name
        return compareNaturalStrings(leftName, rightName)
      }

      if (sortKey === 'status') {
        const rankDelta = getStatusSortRank(getRowStatus(left)) - getStatusSortRank(getRowStatus(right))
        if (rankDelta !== 0) return rankDelta
        const leftName = left.kind === 'active' ? left.active.fileName : left.entry.name
        const rightName = right.kind === 'active' ? right.active.fileName : right.entry.name
        return compareNaturalStrings(leftName, rightName)
      }

      if (sortKey === 'version') {
        const leftVersion = left.kind === 'active' ? left.active.version ?? '' : left.entry.version ?? ''
        const rightVersion = right.kind === 'active' ? right.active.version ?? '' : right.entry.version ?? ''
        const versionCompare = compareNaturalStrings(leftVersion, rightVersion)
        if (versionCompare !== 0) return versionCompare
        const leftName = left.kind === 'active' ? left.active.fileName : left.entry.name
        const rightName = right.kind === 'active' ? right.active.fileName : right.entry.name
        return compareNaturalStrings(leftName, rightName)
      }

      if (sortKey === 'size') {
        const sizeDelta = getDownloadRowSize(left) - getDownloadRowSize(right)
        if (sizeDelta !== 0) return sizeDelta
        const leftName = left.kind === 'active' ? left.active.fileName : left.entry.name
        const rightName = right.kind === 'active' ? right.active.fileName : right.entry.name
        return compareNaturalStrings(leftName, rightName)
      }

      const leftTs = Date.parse(getDownloadRowTimestamp(left))
      const rightTs = Date.parse(getDownloadRowTimestamp(right))
      const safeLeftTs = Number.isNaN(leftTs) ? 0 : leftTs
      const safeRightTs = Number.isNaN(rightTs) ? 0 : rightTs
      if (safeLeftTs !== safeRightTs) return safeLeftTs - safeRightTs
      const leftName = left.kind === 'active' ? left.active.fileName : left.entry.name
      const rightName = right.kind === 'active' ? right.active.fileName : right.entry.name
      return compareNaturalStrings(leftName, rightName)
    })

    return sortDirection === 'asc' ? sorted : sorted.reverse()
  }, [filteredRows, getRowStatus, getStatusSortRank, sortDirection, sortKey])

  const totalRows = sortedRows.length
  const virtualizedDownloads = useVirtualRows({
    containerRef: downloadsScrollRef,
    count: totalRows,
    rowHeight: DOWNLOAD_ROW_HEIGHT,
    overscan: 12,
    enabled: totalRows > DOWNLOAD_VIRTUALIZATION_THRESHOLD,
  })
  const visibleRows = useMemo(
    () => sortedRows.slice(virtualizedDownloads.startIndex, virtualizedDownloads.endIndex),
    [sortedRows, virtualizedDownloads.endIndex, virtualizedDownloads.startIndex]
  )
  const downloadsGridTemplate = isFullscreenViewport
    ? DOWNLOADS_GRID_TEMPLATE_FULLSCREEN
    : isWideDownloadsViewport
    ? DOWNLOADS_GRID_TEMPLATE_WIDE
    : DOWNLOADS_GRID_TEMPLATE

  const getSortAriaSort = useCallback((key: DownloadSortKey): 'none' | 'ascending' | 'descending' => {
    if (sortKey !== key) return 'none'
    return sortDirection === 'asc' ? 'ascending' : 'descending'
  }, [sortDirection, sortKey])

  const handleSort = useCallback((nextKey: DownloadSortKey) => {
    if (sortKey === nextKey) {
      if (sortDirection === 'asc') {
        setSortDirection('desc')
        return
      }
      setSortKey(null)
      setSortDirection('asc')
      return
    }

    setSortKey(nextKey)
    setSortDirection('asc')
  }, [sortDirection, sortKey])

  const browseLikeButtonClass = 'flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border-[0.5px] px-4 text-[10px] brand-font font-bold uppercase tracking-widest transition-colors'
  const darkBrowseLikeButtonClass = `${browseLikeButtonClass} border-[#fcee09]/50 bg-[#0a0a0a] text-[#fcee09] hover:bg-[#fcee09] hover:text-[#050505]`
  const destructiveToolbarButtonClass = `${browseLikeButtonClass} w-10 border-[#5b1818] bg-[#160707] px-0 text-[#f18d8d] hover:border-[#f87171] hover:bg-[#2a0909] hover:text-[#ffe1e1] disabled:cursor-not-allowed disabled:border-[#3a1010] disabled:bg-[#0d0404] disabled:text-[#7c4a4a]`
  const downloadMenuButtonClass = 'flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase'
  const downloadMenuSubtleButtonClass = 'flex items-center w-full px-4 py-2 text-[11px] text-[#9d9d9d] hover:bg-[#111] hover:text-white transition-colors gap-3 tracking-wider font-semibold uppercase'
  const downloadMenuBlueButtonClass = 'flex items-center w-full px-4 py-2 text-[11px] text-[#c6f4ff] hover:bg-[#08141a] hover:text-[#4fd8ff] transition-colors gap-3 tracking-wider font-semibold uppercase'
  const downloadMenuDangerButtonClass = 'flex items-center w-full px-4 py-2 text-[11px] text-[#ffb4ab] hover:bg-[#93000a]/10 transition-colors gap-3 tracking-wider font-semibold uppercase'
  const contextMenuRow = contextMenu?.kind === 'row' ? contextMenu.row : null
  const contextMenuActiveDownload = contextMenuRow?.kind === 'active' ? contextMenuRow.active : null
  const contextMenuLocalEntry = contextMenuRow?.kind === 'local' ? contextMenuRow.entry : null
  const contextMenuRowPath = contextMenuRow ? getDownloadRowPath(contextMenuRow) : null
  const contextMenuInstalledMod = contextMenuLocalEntry ? installedBySourcePath.get(contextMenuLocalEntry.path.toLowerCase()) : null
  const deleteAppearance = DELETE_PROGRESS_APPEARANCE

  const renderDeletingDownloadRow = (entry: DownloadEntry) => {
    const deletingState = deletingDownloads[entry.path]
    const deleteProgress = getTransientDeleteProgress(deletingState?.startedAt ?? deleteProgressTick, deleteProgressTick)

    return (
      <div
        key={`deleting:${entry.path}`}
        data-download-row="true"
        className="relative h-14 overflow-hidden border-b-[0.5px]"
        style={{
          background: deleteAppearance.rowTint,
          borderColor: deleteAppearance.softBorder,
        }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 transition-all duration-500"
          style={{
            width: `${Math.max(0, Math.min(deleteProgress, 100))}%`,
            background: deleteAppearance.fill,
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 w-[2px] transition-all duration-500"
          style={{
            left: `calc(${Math.max(0, Math.min(deleteProgress, 99.6))}% - 1px)`,
            background: deleteAppearance.accent,
            boxShadow: `0 0 10px ${deleteAppearance.accent}aa`,
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{
            background: deleteAppearance.accent,
            boxShadow: `0 0 8px ${deleteAppearance.accent}55`,
          }}
        />
        <div
          className="relative z-10 grid h-14 gap-4 pl-5 pr-5 py-[5px]"
          style={{ gridTemplateColumns: downloadsGridTemplate }}
        >
          <div className="flex min-w-0 flex-col justify-center gap-1 overflow-hidden">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium tracking-tight truncate text-[#ffe1e1]">
                {entry.name}
              </span>
              <span
                className="shrink-0 rounded-sm border-[0.5px] px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest"
                style={{
                  color: deleteAppearance.accent,
                  borderColor: `${deleteAppearance.accent}55`,
                  background: `${deleteAppearance.accent}12`,
                }}
              >
                {deleteAppearance.label}
              </span>
            </div>
          </div>

          <div className="flex items-center">
            <span
              className="shrink-0 rounded-sm border-[0.5px] px-2 py-[3px] text-[9px] brand-font font-bold uppercase tracking-widest"
              style={{
                color: deleteAppearance.accent,
                borderColor: `${deleteAppearance.accent}55`,
                background: `${deleteAppearance.accent}12`,
              }}
            >
              {deleteAppearance.label}
            </span>
          </div>

          <div className="flex items-center text-sm font-mono tracking-tight text-[#d8d8d8]">
            {entry.version ?? '—'}
          </div>

          <div className="flex items-center pl-4 text-sm font-mono tracking-tight text-[#d8d8d8]">
            {formatSize(entry.size)}
          </div>

          <div className="flex flex-col justify-center gap-1 overflow-hidden text-sm font-mono tracking-tight">
            <span className="truncate text-[#d8d8d8]">{formatWindowsDateTime(entry.downloadedAt ?? entry.modifiedAt)}</span>
            <span className="truncate text-[#ffb4ab]">
              {deleteProgress > 0 ? `${deleteProgress}% · ${deleteAppearance.summary}` : deleteAppearance.summary}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] bg-[#0a0a0a]/90"
              style={{
                borderColor: `${deleteAppearance.accent}44`,
                color: deleteAppearance.accent,
              }}
            >
              <span className="material-symbols-outlined animate-spin text-[16px]">delete</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full animate-settings-in">
      <div className="flex flex-col h-full overflow-hidden">

        {/* Fixed header */}
        <div className="shrink-0 px-6 pt-6 pb-3 w-full">
          <h1 className="brand-font text-xl text-white font-bold tracking-widest uppercase">
            Downloads
          </h1>
          <p className="ui-support-mono mt-1 flex items-center gap-2">
            LOCAL: {localFiles.length}
            {activeDownloads.length > 0 && <>&nbsp;|&nbsp; ACTIVE: {activeDownloads.length}</>}
            {searchQuery.trim() && <>&nbsp;|&nbsp; SHOWN: {totalRows}</>}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="group relative min-w-[300px] flex-1 max-w-[460px]">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6a6a6a] text-[18px] transition-colors group-hover:text-[#e8e8e8] group-focus-within:text-[#fcee09]">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search downloads..."
                className="h-10 w-full rounded-sm border-[0.5px] border-[#fcee09]/50 bg-[#0a0a0a] py-1.5 pl-10 pr-4 text-sm text-[#e5e2e1] placeholder-[#6f6f6f] transition-all hover:border-[#fcee09]/70 hover:text-[#e8e8e8] focus:border-[#fcee09]/65 focus:outline-none focus:shadow-[0_0_14px_rgba(252,238,9,0.08)]"
              />
            </div>
            <button
              onClick={() => void doRefresh()}
              className={darkBrowseLikeButtonClass}
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              Refresh
            </button>
            <button
              onClick={openDownloadsFolder}
              className={darkBrowseLikeButtonClass}
            >
              <span className="material-symbols-outlined text-[16px]">folder_open</span>
              Open Folder
            </button>
            <Tooltip content="Delete every file in the downloads folder">
              <button
                onClick={() => setDeleteAllOpen(true)}
                disabled={localFiles.length === 0}
                className={destructiveToolbarButtonClass}
              >
                <span className="material-symbols-outlined text-[18px]">delete_sweep</span>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Unified table */}
        <div className="flex-1 overflow-hidden px-6 pb-6 w-full">
          <div className="h-full bg-[#050505] rounded-sm border-[0.5px] border-[#1a1a1a] overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.24)]">
            <div ref={downloadsScrollRef} className="hyperion-scrollbar h-full overflow-y-auto">

              {/* Sticky column headers */}
              <div
                className="sticky top-0 z-10 grid gap-4 px-5 border-b-[0.5px] border-[#1a1a1a] bg-[#070707]"
                style={{ gridTemplateColumns: downloadsGridTemplate }}
              >
                <button
                  type="button"
                  onClick={() => handleSort('name')}
                  aria-sort={getSortAriaSort('name')}
                  aria-label={`Sort by archive name${sortKey === 'name' ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
                  className="flex h-8 items-center text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-sm uppercase tracking-widest brand-font font-bold ${sortKey === 'name' ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'}`}>Archive Name</span>
                    <span className={`material-symbols-outlined text-[8px] leading-none ${sortKey === 'name' ? 'text-[#fcee09]' : 'text-[#727272]'}`} aria-hidden="true">
                      {sortKey === 'name' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleSort('status')}
                  aria-sort={getSortAriaSort('status')}
                  aria-label={`Sort by status${sortKey === 'status' ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
                  className="flex h-8 items-center text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm uppercase tracking-widest brand-font font-bold ${sortKey === 'status' ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'}`}>Status</span>
                    <span className={`material-symbols-outlined text-[8px] leading-none ${sortKey === 'status' ? 'text-[#fcee09]' : 'text-[#727272]'}`} aria-hidden="true">
                      {sortKey === 'status' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleSort('version')}
                  aria-sort={getSortAriaSort('version')}
                  aria-label={`Sort by version${sortKey === 'version' ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
                  className="flex h-8 items-center text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm uppercase tracking-widest brand-font font-bold ${sortKey === 'version' ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'}`}>Version</span>
                    <span className={`material-symbols-outlined text-[8px] leading-none ${sortKey === 'version' ? 'text-[#fcee09]' : 'text-[#727272]'}`} aria-hidden="true">
                      {sortKey === 'version' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleSort('size')}
                  aria-sort={getSortAriaSort('size')}
                  aria-label={`Sort by size${sortKey === 'size' ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
                  className="flex h-8 items-center pl-4 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm uppercase tracking-widest brand-font font-bold ${sortKey === 'size' ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'}`}>Size</span>
                    <span className={`material-symbols-outlined text-[8px] leading-none ${sortKey === 'size' ? 'text-[#fcee09]' : 'text-[#727272]'}`} aria-hidden="true">
                      {sortKey === 'size' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleSort('downloadedAt')}
                  aria-sort={getSortAriaSort('downloadedAt')}
                  aria-label={`Sort by downloaded date${sortKey === 'downloadedAt' ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
                  className="flex h-8 items-center text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm uppercase tracking-widest brand-font font-bold ${sortKey === 'downloadedAt' ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'}`}>Downloaded At</span>
                    <span className={`material-symbols-outlined text-[8px] leading-none ${sortKey === 'downloadedAt' ? 'text-[#fcee09]' : 'text-[#727272]'}`} aria-hidden="true">
                      {sortKey === 'downloadedAt' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                    </span>
                  </div>
                </button>
                <div className="flex h-8 items-center justify-end text-sm uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">
                  Actions
                </div>
              </div>

              {/* Rows */}
              <div className="relative" onContextMenu={handleDownloadsBlankContextMenu}>
                {loading ? (
                  <div className="flex items-center justify-center py-24 text-[#8a8a8a] font-mono text-sm">
                    Scanning downloads...
                  </div>
                ) : totalRows === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-4">
                    <span className="material-symbols-outlined text-[48px] text-[#7a7a7a]">
                      {searchQuery.trim() ? 'search_off' : 'download'}
                    </span>
                    <span className="text-[#8a8a8a] text-sm font-mono tracking-tight">
                      {searchQuery.trim()
                        ? 'No downloads match this search'
                        : settings?.downloadPath
                        ? 'No archives found in the downloads folder'
                        : 'Set a downloads path in Configuration first'}
                    </span>
                    {!settings?.downloadPath && (
                      <button
                        onClick={() => setActiveView('settings')}
                        className="flex items-center gap-2 px-4 py-2 bg-[#fcee09] text-[#050505] rounded-sm text-xs brand-font font-bold uppercase tracking-widest hover:bg-white transition-colors mt-2"
                      >
                        <span className="material-symbols-outlined text-[16px]">settings</span>
                        Configuration
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      paddingTop: totalRows > DOWNLOAD_VIRTUALIZATION_THRESHOLD ? virtualizedDownloads.paddingTop : 0,
                      paddingBottom: totalRows > DOWNLOAD_VIRTUALIZATION_THRESHOLD ? virtualizedDownloads.paddingBottom : 0,
                    }}
                  >
                    {visibleRows.map((row, visibleIndex) => {
                    if (row.kind === 'active') {
                      const dl = row.active
                    const pct = dl.totalBytes > 0 ? Math.round((dl.downloadedBytes / dl.totalBytes) * 100) : 0
                    const isDone = dl.status === 'done'
                    const isError = dl.status === 'error'
                    const isPaused = dl.status === 'paused'
                    const accent = isDone ? '#34d399' : isError ? '#f87171' : isPaused ? '#60a5fa' : '#fcee09'
                    const rowBorder = isError ? '#3a1313' : isPaused ? '#19304f' : '#1e1a00'
                    const rowTint = isError
                      ? 'rgba(248,113,113,0.04)'
                      : isPaused
                        ? 'rgba(96,165,250,0.05)'
                        : 'rgba(252,238,9,0.035)'
                    const eta = isDone || isError || isPaused ? null : formatETA(dl.downloadedBytes, dl.totalBytes, dl.speedBps)
                    const progressSummary = isError
                      ? dl.error ?? 'Download failed'
                      : isDone
                        ? 'Ready to install'
                        : isPaused
                          ? `Paused at ${pct}%`
                        : `${pct}% complete`
                    const transferSummary = isError
                      ? 'Transfer interrupted'
                      : isDone
                        ? `${formatSize(dl.totalBytes)} downloaded`
                        : `${formatSize(dl.downloadedBytes)} / ${formatSize(dl.totalBytes)}`
                    const speedSummary = isError
                      ? 'Try again'
                      : isDone
                        ? 'Waiting for scan'
                        : isPaused
                          ? 'Resume to continue'
                        : `${formatSpeed(dl.speedBps)}${eta ? ` · ETA ${eta}` : ''}`

                    return (
                      <div
                        key={row.key}
                        data-download-row="true"
                        onContextMenu={(event) => handleDownloadRowContextMenu(event, row)}
                        className="relative h-14 overflow-hidden border-b-[0.5px] border-[#1e1a00]"
                        style={{ background: rowTint, borderColor: rowBorder }}
                      >
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 transition-all duration-500"
                          style={{
                            width: `${Math.max(0, Math.min(pct, 100))}%`,
                            background: isError
                              ? 'linear-gradient(90deg, rgba(248,113,113,0.18) 0%, rgba(248,113,113,0.08) 100%)'
                              : isPaused
                                ? 'linear-gradient(90deg, rgba(96,165,250,0.18) 0%, rgba(96,165,250,0.07) 100%)'
                              : 'linear-gradient(90deg, rgba(252,238,9,0.22) 0%, rgba(252,238,9,0.09) 100%)',
                          }}
                        />
                        {!isError && !isDone && !isPaused && (
                          <div
                            aria-hidden="true"
                            className="absolute inset-y-0 w-[2px] transition-all duration-500"
                            style={{
                              left: `calc(${Math.min(pct, 99.6)}% - 1px)`,
                              background: accent,
                              boxShadow: `0 0 10px ${accent}aa`,
                            }}
                          />
                        )}
                        <div
                          className="absolute inset-y-0 left-0 w-[3px]"
                          style={{ background: accent, boxShadow: `0 0 8px ${accent}55` }}
                        />

                        <div
                          className="relative z-10 grid h-14 gap-4 pl-5 pr-5 py-[5px]"
                          style={{ gridTemplateColumns: downloadsGridTemplate }}
                        >
                          <div className="flex min-w-0 flex-col justify-center gap-1 overflow-hidden">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium tracking-tight truncate text-[#e5e2e1]">
                                {dl.fileName}
                              </span>
                            </div>
                            <span
                              className="text-sm font-mono tracking-tight"
                              style={{ color: isError ? '#fca5a5' : isPaused ? '#93c5fd' : accent }}
                            >
                              {transferSummary}
                            </span>
                          </div>

                          <div className="flex flex-col justify-center gap-1 overflow-hidden">
                            <span
                              className="w-fit rounded-sm border-[0.5px] px-2 py-[3px] text-[9px] brand-font font-bold uppercase tracking-widest"
                              style={{ color: accent, borderColor: `${accent}55`, background: `${accent}12` }}
                            >
                              {isError ? 'Error' : isDone ? 'Downloaded' : isPaused ? 'Paused' : 'Downloading'}
                            </span>
                            <span className={`truncate text-sm font-mono tracking-tight ${isPaused ? 'text-[#93a8c8]' : 'text-[#9a9a9a]'}`}>
                              {progressSummary}
                            </span>
                          </div>

                          <div className="flex items-center text-sm font-mono tracking-tight text-[#9a9a9a]">
                            {dl.version ?? '—'}
                          </div>

                          <div className="flex items-center pl-4 text-sm font-mono tracking-tight text-[#d8d8d8]">
                            {formatSize(Math.max(dl.totalBytes, dl.downloadedBytes))}
                          </div>

                          <div className="flex flex-col justify-center gap-1 overflow-hidden text-sm font-mono tracking-tight">
                            <span className="truncate text-[#d8d8d8]">{formatWindowsDateTime(dl.startedAt)}</span>
                            <span className={`truncate ${isPaused ? 'text-[#93a8c8]' : 'text-[#9a9a9a]'}`}>{speedSummary}</span>
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            {!isDone && !isError && (
                              <>
                                {isPaused ? (
                                  <Tooltip content="Resume download">
                                    <button
                                      onClick={() => void resumeDownload(dl.id)}
                                      className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] border-[#1d3d63] bg-[#07111d]/95 text-[#60a5fa] hover:border-[#60a5fa]/70 hover:bg-[#0b1724] transition-all"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                                    </button>
                                  </Tooltip>
                                ) : (
                                  <Tooltip content="Pause download">
                                    <button
                                      onClick={() => void pauseDownload(dl.id)}
                                      className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] border-[#2a2a2a] bg-[#0a0a0a]/90 text-[#c9c9c9] hover:border-[#fcee09]/45 hover:text-[#fcee09] transition-all"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">pause</span>
                                    </button>
                                  </Tooltip>
                                )}
                                <Tooltip content="Cancel download">
                                  <button
                                    onClick={() => void cancelDownload(dl.id)}
                                    className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] border-[#222] bg-[#0a0a0a]/90 text-[#8a8a8a] hover:border-[#ff4d4f]/45 hover:text-[#ff4d4f] transition-all"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                  </button>
                                </Tooltip>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                    }

                  const entry = row.entry
                  const index = virtualizedDownloads.startIndex + visibleIndex
                  const isInstalling = installing && installSourcePath === entry.path
                  const isDeleting = Boolean(deletingDownloads[entry.path])
                  const installAppearance = isInstalling
                    ? getInstallProgressAppearance(installStatus)
                    : null
                  const installedMod = installedBySourcePath.get(entry.path.toLowerCase())
                  const isNew = newFilesSet.has(entry.path.toLowerCase())
                  const rowBg = index % 2 === 0
                    ? 'bg-[#050505] hover:bg-[#141414]'
                    : 'bg-[#0a0a0a] hover:bg-[#161616]'

                  if (isInstalling && installAppearance) {
                    const progressSummary = `${installStatus || installAppearance.label} ${installProgress > 0 ? `${installProgress}%` : ''}`.trim()
                    const progressDetail = installCurrentFile || installAppearance.detailFallback

                    return (
                      <div
                        key={row.key}
                        data-download-row="true"
                        onContextMenu={(event) => handleDownloadRowContextMenu(event, row)}
                        className="relative h-14 overflow-hidden border-b-[0.5px]"
                        style={{
                          background: installAppearance.rowTint,
                          borderColor: installAppearance.softBorder,
                        }}
                      >
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 transition-all duration-500"
                          style={{
                            width: `${Math.max(0, Math.min(installProgress, 100))}%`,
                            background: installAppearance.fill,
                          }}
                        />
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 w-[2px] transition-all duration-500"
                          style={{
                            left: `calc(${Math.max(0, Math.min(installProgress, 99.6))}% - 1px)`,
                            background: installAppearance.accent,
                            boxShadow: `0 0 10px ${installAppearance.accent}aa`,
                          }}
                        />
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-[3px]"
                          style={{
                            background: installAppearance.accent,
                            boxShadow: `0 0 8px ${installAppearance.accent}55`,
                          }}
                        />
                        <div
                          className="relative z-10 grid h-14 gap-4 pl-5 pr-5 py-[5px]"
                          style={{ gridTemplateColumns: downloadsGridTemplate }}
                        >
                          <div className="flex min-w-0 flex-col justify-center gap-1 overflow-hidden">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium tracking-tight truncate text-[#e5e2e1]">
                                {entry.name}
                              </span>
                            </div>
                            <span
                              className="truncate text-sm font-mono tracking-tight"
                              style={{ color: installAppearance.accent }}
                            >
                              {progressDetail}
                            </span>
                          </div>

                          <div className="flex flex-col justify-center gap-1 overflow-hidden">
                            <span
                              className="w-fit rounded-sm border-[0.5px] px-2 py-[3px] text-[9px] brand-font font-bold uppercase tracking-widest"
                              style={{
                                color: installAppearance.accent,
                                borderColor: `${installAppearance.accent}55`,
                                background: `${installAppearance.accent}12`,
                              }}
                            >
                              {installAppearance.label}
                            </span>
                            <span className="truncate text-sm font-mono tracking-tight text-[#d8d8d8]">
                              {progressSummary}
                            </span>
                          </div>

                          <div className="flex items-center text-sm font-mono tracking-tight text-[#d8d8d8]">
                            {entry.version ?? '—'}
                          </div>

                          <div className="flex items-center pl-4 text-sm font-mono tracking-tight text-[#d8d8d8]">
                            {formatSize(entry.size)}
                          </div>

                          <div className="flex flex-col justify-center gap-1 overflow-hidden text-sm font-mono tracking-tight">
                            <span className="truncate text-[#d8d8d8]">{formatWindowsDateTime(entry.downloadedAt ?? entry.modifiedAt)}</span>
                            <span className="truncate text-[#9a9a9a]">{installAppearance.summary}</span>
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <div
                              className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] bg-[#0a0a0a]/90"
                              style={{
                                borderColor: `${installAppearance.accent}44`,
                                color: installAppearance.accent,
                              }}
                            >
                              <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  }

                  if (isDeleting) {
                    return renderDeletingDownloadRow(entry)
                  }

                  return (
                    <div
                      key={row.key}
                      data-download-row="true"
                      onContextMenu={(event) => handleDownloadRowContextMenu(event, row)}
                      className={`grid h-14 gap-4 pl-5 pr-5 py-[5px] border-b-[0.5px] border-[#1a1a1a] relative overflow-hidden group cursor-default transition-[background-color,border-color] duration-150 ${rowBg} hover:border-[#363636]`}
                      style={{ gridTemplateColumns: downloadsGridTemplate }}
                    >
                      {/* Hover gradient overlay */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                        style={{
                          background: isNew
                            ? 'linear-gradient(90deg, rgba(252,238,9,0.07) 0%, rgba(252,238,9,0.025) 20%, transparent 60%)'
                            : 'linear-gradient(90deg, rgba(252,238,9,0.05) 0%, rgba(252,238,9,0.02) 18%, transparent 60%)',
                        }}
                      />
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 left-0 w-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                        style={{ background: isNew ? '#fcee09' : 'rgba(252,238,9,0.55)' }}
                      />
                      {/* Persistent left bar for NEW files */}
                      {isNew && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 left-0 w-[2px]"
                          style={{ background: 'rgba(252,238,9,0.4)' }}
                        />
                      )}

                      {/* Col 1: name + NEW badge */}
                      <div className="flex items-center overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium tracking-tight truncate text-[#e5e2e1] group-hover:text-white transition-colors">
                            {entry.name}
                          </span>
                          {isNew && (
                            <span className="shrink-0 px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest bg-[#fcee09] text-[#050505] rounded-sm">
                              NEW
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Col 2: status */}
                      <div className="flex items-center">
                        <span
                          className={`shrink-0 rounded-sm border-[0.5px] px-2 py-[3px] text-[9px] brand-font font-bold uppercase tracking-widest ${
                            installedMod
                              ? 'border-[#7a7a7a]/70 bg-[#101010] text-[#f0f0f0]'
                              : 'border-[#fcee09]/35 bg-[#0a0a0a] text-[#bdbdbd]'
                          }`}
                        >
                          {installedMod ? 'Installed' : 'Downloaded'}
                        </span>
                      </div>

                      {/* Col 3: version */}
                      <div className="flex items-center text-sm font-mono tracking-tight text-[#9a9a9a] group-hover:text-[#c4c4c4] transition-colors">
                        {entry.version ?? '—'}
                      </div>

                      {/* Col 4: size */}
                      <div className="flex items-center pl-4 text-sm font-mono tracking-tight text-[#9a9a9a] group-hover:text-[#c4c4c4] transition-colors">
                        {formatSize(entry.size)}
                      </div>

                      {/* Col 5: downloaded date */}
                      <div className="flex items-center text-sm font-mono tracking-tight text-[#9a9a9a] group-hover:text-[#bdbdbd] transition-colors">
                        {formatWindowsDateTime(entry.downloadedAt ?? entry.modifiedAt)}
                      </div>

                      {/* Col 6: install + delete */}
                      <div className="flex items-center justify-end gap-2">
                        <Tooltip content={installedMod ? 'Reinstall archive' : 'Install archive'}>
                          <button
                            onClick={() => void handleInstall(entry)}
                            disabled={isInstalling}
                            className={`flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] transition-all disabled:opacity-50 ${
                              installedMod
                                ? 'border-[#7a7a7a] bg-[#0a0a0a] text-[#f0f0f0] hover:border-[#fcee09] hover:text-[#fcee09]'
                                : 'border-[#fcee09]/40 bg-[#0a0a0a] text-[#fcee09] hover:bg-[#fcee09] hover:text-[#050505]'
                            } disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#fcee09]`}
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              {installedMod ? 'restart_alt' : 'deployed_code'}
                            </span>
                          </button>
                        </Tooltip>
                        <Tooltip content="Delete download">
                          <button
                            onClick={() => setPendingDeleteDownload(entry)}
                            className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] border-[#3a1010] bg-[#0d0404] text-[#f18d8d] transition-colors hover:border-[#f87171] hover:bg-[#1a0505] hover:text-[#ffe1e1]"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  )
                })}
                </div>
              )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-[100] min-w-[220px] border-[0.5px] border-[#222] bg-[#0a0a0a] py-1 shadow-[0_10px_30px_rgba(0,0,0,0.5)] brand-font"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.kind === 'blank' ? (
            <>
              <button
                onClick={() => void handleRefreshDownloads()}
                className={downloadMenuButtonClass}
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                <span>Refresh Downloads</span>
              </button>
              <button
                onClick={() => {
                  setContextMenu(null)
                  openDownloadsFolder()
                }}
                disabled={!settings?.downloadPath}
                className={`${downloadMenuButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span>Open Downloads Folder</span>
              </button>
              <div className="my-1 border-t-[0.5px] border-[#222]" />
              <button
                onClick={() => {
                  setDeleteAllOpen(true)
                  setContextMenu(null)
                }}
                disabled={localFiles.length === 0}
                className={`${downloadMenuDangerButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
                <span>Delete All Downloads</span>
              </button>
            </>
          ) : contextMenu.row.kind === 'active' ? (
            <>
              <button
                onClick={() => void handleOpenDownloadsLocation()}
                disabled={!contextMenuRowPath}
                className={`${downloadMenuButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span>Open File Location</span>
              </button>
              <button
                onClick={() => void handleRefreshDownloads()}
                className={downloadMenuButtonClass}
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                <span>Refresh</span>
              </button>
              <div className="my-1 border-t-[0.5px] border-[#222]" />
              <button
                onClick={() => void handleToggleDownloadState()}
                className={contextMenuActiveDownload?.status === 'paused'
                  ? downloadMenuBlueButtonClass
                  : contextMenuActiveDownload?.status === 'error'
                    ? downloadMenuDangerButtonClass
                    : downloadMenuButtonClass}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {contextMenuActiveDownload?.status === 'paused'
                    ? 'play_arrow'
                    : contextMenuActiveDownload?.status === 'error'
                      ? 'delete'
                      : 'pause'}
                </span>
                <span>
                  {contextMenuActiveDownload?.status === 'paused'
                    ? 'Resume'
                    : contextMenuActiveDownload?.status === 'error'
                      ? 'Remove from List'
                      : 'Pause'}
                </span>
              </button>
              {contextMenuActiveDownload?.status !== 'error' && (
                <button
                  onClick={() => void handleCancelContextDownload()}
                  className={downloadMenuDangerButtonClass}
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                  <span>Cancel Download</span>
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => void handleInstallContextRow()}
                disabled={Boolean(contextMenuLocalEntry && installing && installSourcePath === contextMenuLocalEntry.path)}
                className={`${downloadMenuButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="material-symbols-outlined text-[16px]">{contextMenuInstalledMod ? 'restart_alt' : 'deployed_code'}</span>
                <span>{contextMenuInstalledMod ? 'Reinstall' : 'Install'}</span>
              </button>
              <div className="my-1 border-t-[0.5px] border-[#222]" />
              <button
                onClick={() => void handleOpenDownloadsLocation()}
                disabled={!contextMenuRowPath}
                className={`${downloadMenuButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span>Open File Location</span>
              </button>
              <button
                onClick={() => void handleRefreshDownloads()}
                className={downloadMenuButtonClass}
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                <span>Refresh</span>
              </button>
              <div className="my-1 border-t-[0.5px] border-[#222]" />
              <button
                onClick={() => {
                  if (!contextMenuLocalEntry) return
                  setPendingDeleteDownload(contextMenuLocalEntry)
                  setContextMenu(null)
                }}
                className={downloadMenuDangerButtonClass}
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Delete Download</span>
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {pendingDeleteDownload && (
        <ActionPromptDialog
          accentColor="#ff4d4f"
          accentGlow="rgba(255,77,79,0.45)"
          title="Delete Download"
          description={`You are about to permanently delete ${pendingDeleteDownload.name} from your downloads path.`}
          detailLabel="File to delete"
          detailValue={pendingDeleteDownload.name}
          icon="delete"
          primaryLabel="Delete"
          onPrimary={() => void handleDeleteDownload()}
          onCancel={() => setPendingDeleteDownload(null)}
          primaryTextColor="#ffffff"
        />
      )}

      {deleteAllOpen && (
        <ActionPromptDialog
          accentColor="#ff4d4f"
          accentGlow="rgba(255,77,79,0.4)"
          title="Delete All Downloads"
          description="This permanently deletes every archive currently listed in your downloads folder. Files already installed as mods will not be affected."
          detailLabel="Files to delete"
          detailValue={String(localFiles.length)}
          icon="delete_sweep"
          primaryLabel="Delete Everything"
          primaryTextColor="#ffffff"
          onPrimary={() => void handleDeleteAllDownloads()}
          onCancel={() => setDeleteAllOpen(false)}
          submitting={deletingAll}
        />
      )}
    </div>
  )
}
