import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IpcService } from '../../services/IpcService'
import type { DownloadEntry, IpcResult, ModMetadata } from '@shared/types'
import { IPC } from '@shared/types'
import {
  DOWNLOADS_GRID_TEMPLATE,
  DOWNLOADS_GRID_TEMPLATE_FULLSCREEN,
  DOWNLOADS_GRID_TEMPLATE_WIDE,
  DownloadsTableHeader,
} from './DownloadsTableHeader'
import type { DownloadSortDirection, DownloadSortKey } from './DownloadsTableHeader'
import {
  DownloadsRow,
  getDownloadRowSize,
  getDownloadRowTimestamp,
} from './DownloadsRows'
import type { DownloadListRow } from './DownloadsRows'
import { DownloadsToolbar } from './DownloadsToolbar'
import { ActionPromptDialog } from '../ui/ActionPromptDialog'
import { HyperionPanel } from '../ui/HyperionPrimitives'
import { useVirtualRows } from '../../hooks/useVirtualRows'

const DOWNLOAD_ROW_HEIGHT = 56
const DOWNLOAD_VIRTUALIZATION_THRESHOLD = 120
const DOWNLOADS_SEARCH_STORAGE_KEY = 'hyperion:downloadsSearch'
const DOWNLOADS_SORT_STORAGE_KEY = 'hyperion:downloadsSort'

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
    const raw = localStorage.getItem(DOWNLOADS_SORT_STORAGE_KEY) ?? ''
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
      return
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

  const downloadMenuButtonClass = 'flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase'
  const downloadMenuSubtleButtonClass = 'flex items-center w-full px-4 py-2 text-[11px] text-[#9d9d9d] hover:bg-[#111] hover:text-white transition-colors gap-3 tracking-wider font-semibold uppercase'
  const downloadMenuBlueButtonClass = 'flex items-center w-full px-4 py-2 text-[11px] text-[#c6f4ff] hover:bg-[#08141a] hover:text-[#4fd8ff] transition-colors gap-3 tracking-wider font-semibold uppercase'
  const downloadMenuDangerButtonClass = 'flex items-center w-full px-4 py-2 text-[11px] text-[#ffb4ab] hover:bg-[#93000a]/10 transition-colors gap-3 tracking-wider font-semibold uppercase'
  const contextMenuRow = contextMenu?.kind === 'row' ? contextMenu.row : null
  const contextMenuActiveDownload = contextMenuRow?.kind === 'active' ? contextMenuRow.active : null
  const contextMenuLocalEntry = contextMenuRow?.kind === 'local' ? contextMenuRow.entry : null
  const contextMenuRowPath = contextMenuRow ? getDownloadRowPath(contextMenuRow) : null
  const contextMenuInstalledMod = contextMenuLocalEntry ? installedBySourcePath.get(contextMenuLocalEntry.path.toLowerCase()) : null

  return (
    <div className="h-full animate-settings-in">
      <div className="flex flex-col h-full overflow-hidden">

        <DownloadsToolbar
          searchQuery={searchQuery}
          localFileCount={localFiles.length}
          activeDownloadCount={activeDownloads.length}
          totalRows={totalRows}
          onSearchQueryChange={setSearchQuery}
          onRefresh={doRefresh}
          onOpenFolder={openDownloadsFolder}
          onDeleteAll={() => setDeleteAllOpen(true)}
        />

        {/* Unified table */}
        <div className="flex-1 overflow-hidden px-6 pb-6 w-full">
          <HyperionPanel className="h-full overflow-hidden">
            <div ref={downloadsScrollRef} className="hyperion-scrollbar h-full overflow-y-auto">

              <DownloadsTableHeader
                gridTemplate={downloadsGridTemplate}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSort}
              />

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
                      const entry = row.kind === 'local' ? row.entry : null
                      const deletingState = entry ? deletingDownloads[entry.path] : undefined

                      return (
                        <DownloadsRow
                          key={row.key}
                          row={row}
                          rowIndex={virtualizedDownloads.startIndex + visibleIndex}
                          gridTemplate={downloadsGridTemplate}
                          installedMod={entry ? installedBySourcePath.get(entry.path.toLowerCase()) : null}
                          isNew={entry ? newFilesSet.has(entry.path.toLowerCase()) : false}
                          isInstalling={Boolean(entry && installing && installSourcePath === entry.path)}
                          isDeleting={Boolean(deletingState)}
                          installProgress={installProgress}
                          installStatus={installStatus}
                          installCurrentFile={installCurrentFile}
                          deleteStartedAt={deletingState?.startedAt}
                          deleteProgressTick={deleteProgressTick}
                          onContextMenu={handleDownloadRowContextMenu}
                          onInstall={handleInstall}
                          onDeleteRequest={(downloadEntry) => setPendingDeleteDownload(downloadEntry)}
                          onPauseDownload={pauseDownload}
                          onResumeDownload={resumeDownload}
                          onCancelDownload={cancelDownload}
                        />
                      )
                    })}
                </div>
              )}
              </div>
            </div>
          </HyperionPanel>
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
