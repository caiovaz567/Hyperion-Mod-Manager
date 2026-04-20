import React, { useState, useCallback, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IpcService } from '../../services/IpcService'
import type { ModMetadata } from '@shared/types'
import { IPC } from '@shared/types'
import { MemoModRow } from './ModRow'
import { DetailPanel } from './DetailPanel'
import { ActionPromptDialog } from '../ui/ActionPromptDialog'
import { SeparatorNameDialog } from '../ui/SeparatorNameDialog'
import { Tooltip } from '../ui/Tooltip'
import type { LibraryStatusFilter } from '../../store/slices/createLibrarySlice'
import { getInstallProgressAppearance } from '../../utils/installProgressAppearance'
import { DELETE_PROGRESS_APPEARANCE, getTransientDeleteProgress } from '../../utils/deleteProgressAppearance'
import { useVirtualRows } from '../../hooks/useVirtualRows'

type ContextMenuState =
  | {
      kind: 'row'
      mod: ModMetadata
      x: number
      y: number
    }
  | {
      kind: 'list'
      x: number
      y: number
      insertIndex: number
    }

interface DetailOverlayState {
  modId: string
  initialEditName?: boolean
}

interface SeparatorDialogState {
  mode: 'create' | 'rename'
  separatorId?: string
  value: string
  insertIndex?: number
}

type PendingActionState =
  | { type: 'delete-all'; count: number }
  | { type: 'delete-selected'; count: number; modIds: string[] }

type LibrarySortKey = 'name' | 'type' | 'installedAt'
type SortDirection = 'asc' | 'desc'

const LIBRARY_GRID_TEMPLATE = '64px 56px minmax(320px,1fr) 110px 156px 184px 96px'
const MOD_ROW_HEIGHT = 38
const MOD_VIRTUALIZATION_THRESHOLD = 120
const INTERNAL_MOD_DRAG_TYPE = 'application/x-hyperion-mod-ids'

const getInstallDisplayName = (sourcePath: string, currentFile: string): string => {
  const raw = currentFile || sourcePath
  if (!raw) return 'Installing mod'
  const normalized = raw.replace(/\//g, '\\')
  const parts = normalized.split('\\').filter(Boolean)
  return parts[parts.length - 1] ?? raw
}

export const ModList: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const selectedIdsRef = useRef<string[]>([])
  const selectionAnchorIdRef = useRef<string | null>(null)
  const displayedModsRef = useRef<ModMetadata[]>([])
  const draggedModIdsRef = useRef<string[]>([])
  const separatorRevealTimeoutRef = useRef<number | null>(null)
  const [pendingDeleteMod, setPendingDeleteMod] = useState<ModMetadata | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingActionState | null>(null)
  const [detailOverlay, setDetailOverlay] = useState<DetailOverlayState | null>(null)
  const [renamingModId, setRenamingModId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [submittingAction, setSubmittingAction] = useState(false)
  const [sortKey, setSortKey] = useState<LibrarySortKey | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [draggedModIds, setDraggedModIds] = useState<string[]>([])
  const [collapsedSeparatorIds, setCollapsedSeparatorIds] = useState<string[]>([])
  const [recentlyRevealedSeparatorId, setRecentlyRevealedSeparatorId] = useState<string | null>(null)
  const [rowDropTarget, setRowDropTarget] = useState<{ targetId: string; position: 'before' | 'after' } | null>(null)
  const [dropSeparatorId, setDropSeparatorId] = useState<string | null>(null)
  const [topLevelDropActive, setTopLevelDropActive] = useState(false)
  const [separatorDialog, setSeparatorDialog] = useState<SeparatorDialogState | null>(null)
  const [separatorDialogSubmitting, setSeparatorDialogSubmitting] = useState(false)
  const [moveSeparatorMenuOpen, setMoveSeparatorMenuOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [deletingRows, setDeletingRows] = useState<Record<string, { startedAt: number }>>({})
  const [deleteProgressTick, setDeleteProgressTick] = useState(() => Date.now())
  const filterRef = useRef<HTMLDivElement>(null)
  const moveSeparatorMenuRef = useRef<HTMLDivElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const listRowsRef = useRef<HTMLDivElement>(null)
  const [isBulkToggling, setIsBulkToggling] = useState(false)

  const {
    filter,
    setFilter,
    selectMod,
    installMod,
    enableMod,
    disableMod,
    deleteMod,
    createSeparator,
    scanMods,
    openReinstallPrompt,
    addToast,
    mods,
    libraryStatusFilter,
    setLibraryStatusFilter,
    requestLibraryDeleteAll,
    libraryDeleteAllRequestedAt,
    clearLibraryDeleteAllRequest,
    settings,
    setActiveView,
    updateModMetadata,
    gamePathValid,
    libraryPathValid,
    typeFilter,
    installing,
    installSourcePath,
    installTargetModId,
    installPlacement,
    installProgress,
    installStatus,
    installCurrentFile,
  } = useAppStore((state) => ({
    filter: state.filter,
    setFilter: state.setFilter,
    selectMod: state.selectMod,
    installMod: state.installMod,
    enableMod: state.enableMod,
    disableMod: state.disableMod,
    deleteMod: state.deleteMod,
    createSeparator: state.createSeparator,
    scanMods: state.scanMods,
    openReinstallPrompt: state.openReinstallPrompt,
    addToast: state.addToast,
    mods: state.mods,
    libraryStatusFilter: state.libraryStatusFilter,
    setLibraryStatusFilter: state.setLibraryStatusFilter,
    requestLibraryDeleteAll: state.requestLibraryDeleteAll,
    libraryDeleteAllRequestedAt: state.libraryDeleteAllRequestedAt,
    clearLibraryDeleteAllRequest: state.clearLibraryDeleteAllRequest,
    settings: state.settings,
    setActiveView: state.setActiveView,
    updateModMetadata: state.updateModMetadata,
    gamePathValid: state.gamePathValid,
    libraryPathValid: state.libraryPathValid,
    typeFilter: state.typeFilter,
    installing: state.installing,
    installSourcePath: state.installSourcePath,
    installTargetModId: state.installTargetModId,
    installPlacement: state.installPlacement,
    installProgress: state.installProgress,
    installStatus: state.installStatus,
    installCurrentFile: state.installCurrentFile,
  }), shallow)

  const hasRequiredPaths = Boolean(settings?.gamePath?.trim() && settings?.libraryPath?.trim() && gamePathValid && libraryPathValid)
  const installAppearance = getInstallProgressAppearance(installStatus)
  const deleteAppearance = DELETE_PROGRESS_APPEARANCE

  const finalizeInstalledMod = useCallback(async (
    mod: ModMetadata,
    successMessage: string,
    shouldEnable = true,
  ) => {
    await scanMods()

    if (!shouldEnable) {
      addToast(successMessage, 'success')
      return
    }

    const enableResult = await enableMod(mod.uuid)
    if (!enableResult.ok) {
      addToast(`Installed but couldn't activate: ${enableResult.error}`, 'warning')
      return
    }

    addToast(successMessage, 'success')
  }, [scanMods, enableMod, addToast])

  const markRowsDeleting = useCallback((modIds: string[]) => {
    const startedAt = Date.now()
    setDeletingRows((current) => {
      const next = { ...current }
      for (const modId of modIds) {
        next[modId] = { startedAt }
      }
      return next
    })
  }, [])

  const clearDeletingRows = useCallback((modIds: string[]) => {
    setDeletingRows((current) => {
      if (modIds.every((modId) => !current[modId])) return current
      const next = { ...current }
      for (const modId of modIds) {
        delete next[modId]
      }
      return next
    })
  }, [])

  useEffect(() => {
    const closeMenu = () => setContextMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [])

  useEffect(() => {
    const deletingIds = Object.keys(deletingRows)
    if (deletingIds.length === 0) return

    const intervalId = window.setInterval(() => {
      setDeleteProgressTick(Date.now())
    }, 120)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [deletingRows])

  const orderedEntries = useMemo(
    () => [...mods].sort((left, right) => left.order - right.order),
    [mods]
  )
  const allMods = orderedEntries.filter((mod) => mod.kind === 'mod')
  const allSeparators = orderedEntries.filter((mod) => mod.kind === 'separator')
  const allSeparatorIds = useMemo(
    () => allSeparators.map((separator) => separator.uuid),
    [allSeparators]
  )
  const hasCollapsedSeparators = collapsedSeparatorIds.length > 0
  const enabledCount = allMods.filter((mod) => mod.enabled).length
  const totalCount = allMods.length

  const filteredBySearchAndType = useMemo(() => {
    let list = allMods

    if (filter) {
      const lower = filter.toLowerCase()
      list = list.filter((mod) =>
        mod.name.toLowerCase().includes(lower) ||
        mod.author?.toLowerCase().includes(lower)
      )
    }

    if (typeFilter) {
      list = list.filter((mod) => mod.type === typeFilter)
    }

    return list
  }, [allMods, filter, typeFilter])

  const filteredModsByStatus = useMemo(() => {
    if (libraryStatusFilter === 'enabled') return filteredBySearchAndType.filter((mod) => mod.enabled)
    if (libraryStatusFilter === 'disabled') return filteredBySearchAndType.filter((mod) => !mod.enabled)
    return filteredBySearchAndType
  }, [filteredBySearchAndType, libraryStatusFilter])

  const visibleFilteredIds = useMemo(
    () => new Set(filteredModsByStatus.map((mod) => mod.uuid)),
    [filteredModsByStatus]
  )
  const collapsedSeparatorSet = useMemo(
    () => new Set(collapsedSeparatorIds),
    [collapsedSeparatorIds]
  )

  const hasActiveLibraryFilter = Boolean(filter || typeFilter || libraryStatusFilter !== 'all')
  const enabledVisibleCount = filteredModsByStatus.filter((mod) => mod.enabled).length
  const disabledVisibleCount = filteredModsByStatus.filter((mod) => !mod.enabled).length

  const separatorSummary = useMemo(() => {
    const total = new Map<string, number>()
    const visible = new Map<string, number>()
    let currentSeparatorId: string | null = null

    for (const entry of orderedEntries) {
      if (entry.kind === 'separator') {
        currentSeparatorId = entry.uuid
        total.set(entry.uuid, 0)
        visible.set(entry.uuid, 0)
        continue
      }

      if (!currentSeparatorId) continue

      total.set(currentSeparatorId, (total.get(currentSeparatorId) ?? 0) + 1)
      if (visibleFilteredIds.has(entry.uuid)) {
        visible.set(currentSeparatorId, (visible.get(currentSeparatorId) ?? 0) + 1)
      }
    }

    return { total, visible }
  }, [orderedEntries, visibleFilteredIds])

  const customOrderEntries = useMemo(() => {
    const rows: ModMetadata[] = []
    let pendingSeparator: ModMetadata | null = null
    let pendingChildren: ModMetadata[] = []

    const flushPendingGroup = () => {
      if (!pendingSeparator) {
        rows.push(...pendingChildren)
        pendingChildren = []
        return
      }

      const visibleChildCount = separatorSummary.visible.get(pendingSeparator.uuid) ?? 0
      if (!hasActiveLibraryFilter || visibleChildCount > 0) {
        rows.push(pendingSeparator)
        if (!collapsedSeparatorSet.has(pendingSeparator.uuid)) {
          rows.push(...pendingChildren)
        }
      }

      pendingSeparator = null
      pendingChildren = []
    }

    for (const entry of orderedEntries) {
      if (entry.kind === 'separator') {
        flushPendingGroup()
        pendingSeparator = entry
        continue
      }

      if (!visibleFilteredIds.has(entry.uuid)) continue
      pendingChildren.push(entry)
    }

    flushPendingGroup()
    return rows
  }, [collapsedSeparatorSet, hasActiveLibraryFilter, orderedEntries, separatorSummary.visible, visibleFilteredIds])

  const displayedMods = useMemo(() => {
    if (sortKey === null) return customOrderEntries

    const sorted = [...filteredModsByStatus].sort((left, right) => {
      if (sortKey === 'name') {
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
      }

      if (sortKey === 'type') {
        return left.type.localeCompare(right.type, undefined, { sensitivity: 'base' })
      }

      const leftTime = left.installedAt ? new Date(left.installedAt).getTime() : 0
      const rightTime = right.installedAt ? new Date(right.installedAt).getTime() : 0
      return leftTime - rightTime
    })

    return sortDirection === 'asc' ? sorted : sorted.reverse()
  }, [customOrderEntries, filteredModsByStatus, sortDirection, sortKey])

  const nestedModIds = useMemo(() => {
    if (sortKey !== null) return new Set<string>()

    const nestedIds = new Set<string>()
    let insideSeparator = false

    for (const entry of displayedMods) {
      if (entry.kind === 'separator') {
        insideSeparator = true
        continue
      }

      if (insideSeparator) {
        nestedIds.add(entry.uuid)
      }
    }

    return nestedIds
  }, [displayedMods, sortKey])

  const separatorParentByModId = useMemo(() => {
    const parentMap = new Map<string, string>()
    let currentSeparatorId: string | null = null

    for (const entry of orderedEntries) {
      if (entry.kind === 'separator') {
        currentSeparatorId = entry.uuid
        continue
      }

      if (currentSeparatorId) {
        parentMap.set(entry.uuid, currentSeparatorId)
      }
    }

    return parentMap
  }, [orderedEntries])

  const orderedEntryIds = useMemo(
    () => new Set(orderedEntries.map((entry) => entry.uuid)),
    [orderedEntries]
  )

  const getSeparatorBlockIds = useCallback((separatorId: string) => {
    const separatorIndex = orderedEntries.findIndex((entry) => entry.uuid === separatorId)
    if (separatorIndex < 0) return []

    const blockIds = [separatorId]
    for (let index = separatorIndex + 1; index < orderedEntries.length; index += 1) {
      const entry = orderedEntries[index]
      if (entry.kind === 'separator') break
      blockIds.push(entry.uuid)
    }

    return blockIds
  }, [orderedEntries])

  const expandSelectionWithSeparatorBlocks = useCallback((ids: string[]) => {
    const expandedSet = new Set<string>()

    for (const id of ids) {
      const entry = orderedEntries.find((candidate) => candidate.uuid === id)
      if (!entry) continue

      if (entry.kind === 'separator') {
        for (const blockId of getSeparatorBlockIds(entry.uuid)) {
          expandedSet.add(blockId)
        }
        continue
      }

      expandedSet.add(entry.uuid)
    }

    return orderedEntries
      .filter((entry) => expandedSet.has(entry.uuid))
      .map((entry) => entry.uuid)
  }, [getSeparatorBlockIds, orderedEntries])

  const insertSeparatorAtDisplayIndex = useCallback(async (separatorId: string, displayIndex?: number) => {
    const currentEntries = [...useAppStore.getState().mods].sort((left, right) => left.order - right.order)
    const nextEntries = [...currentEntries.filter((entry) => entry.uuid !== separatorId)]
    const separator = currentEntries.find((entry) => entry.uuid === separatorId)

    if (!separator) return

    if (displayIndex === undefined || displayedMods.length === 0) {
      nextEntries.push(separator)
      await useAppStore.getState().reorderMods(nextEntries.map((entry) => entry.uuid))
      return
    }

    const clampedIndex = Math.max(0, Math.min(displayIndex, displayedMods.length))
    const anchorBefore = clampedIndex < displayedMods.length ? displayedMods[clampedIndex] : null
    const anchorAfter = clampedIndex > 0 ? displayedMods[clampedIndex - 1] : null

    if (anchorBefore) {
      const insertAt = nextEntries.findIndex((entry) => entry.uuid === anchorBefore.uuid)
      if (insertAt >= 0) {
        nextEntries.splice(insertAt, 0, separator)
        await useAppStore.getState().reorderMods(nextEntries.map((entry) => entry.uuid))
        return
      }
    }

    if (anchorAfter) {
      const insertAt = nextEntries.findIndex((entry) => entry.uuid === anchorAfter.uuid)
      if (insertAt >= 0) {
        nextEntries.splice(insertAt + 1, 0, separator)
        await useAppStore.getState().reorderMods(nextEntries.map((entry) => entry.uuid))
        return
      }
    }

    nextEntries.unshift(separator)
    await useAppStore.getState().reorderMods(nextEntries.map((entry) => entry.uuid))
  }, [displayedMods])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedEntries = useMemo(
    () => orderedEntries.filter((entry) => selectedIds.includes(entry.uuid)),
    [orderedEntries, selectedIds]
  )
  const selectedMods = useMemo(
    () => selectedEntries.filter((entry) => entry.kind === 'mod'),
    [selectedEntries]
  )
  const selectedModIds = useMemo(
    () => selectedMods.map((entry) => entry.uuid),
    [selectedMods]
  )
  const selectedModCount = selectedModIds.length
  const draggedModCount = useMemo(
    () => orderedEntries.filter((entry) => entry.kind === 'mod' && draggedModIds.includes(entry.uuid)).length,
    [draggedModIds, orderedEntries]
  )
  const loadOrderMap = useMemo(() => {
    const map = new Map<string, number>()
    allMods.forEach((mod, i) => map.set(mod.uuid, i + 1))
    return map
  }, [allMods])
  const visibleModIds = displayedMods.filter((mod) => mod.kind === 'mod').map((mod) => mod.uuid)
  const visibleEnabledCount = displayedMods.filter((mod) => mod.kind === 'mod' && mod.enabled).length
  const allVisibleEnabled = visibleModIds.length > 0 && visibleEnabledCount === visibleModIds.length
  const showCustomOrderBadge = sortKey === null && allSeparators.length > 0
  const showTopLevelHeaderDrop = showCustomOrderBadge && draggedModIds.length > 0
  const bulkSelectionActive = selectedModCount > 1
  const bulkToggleDisabled = libraryStatusFilter !== 'all'
  const bulkToggleTooltip = libraryStatusFilter === 'enabled'
    ? 'Unavailable while Enabled filter is active'
    : 'Unavailable while Disabled filter is active'
  const installTargetMod = installTargetModId
    ? allMods.find((mod) => mod.uuid === installTargetModId) ?? null
    : null
  const installTargetNested = installTargetMod ? nestedModIds.has(installTargetMod.uuid) : false
  const installDisplayName = installTargetMod?.name ?? getInstallDisplayName(installSourcePath, installCurrentFile)
  const hasAppendInstallRow = installing && installPlacement === 'append'
  const hasInsertAfterInstallRow = installing && installPlacement === 'insert-after'

  selectedIdsRef.current = selectedIds
  selectionAnchorIdRef.current = selectionAnchorId
  displayedModsRef.current = displayedMods

  const virtualizedMods = useVirtualRows({
    containerRef: listScrollRef,
    count: displayedMods.length + (hasAppendInstallRow || hasInsertAfterInstallRow ? 1 : 0),
    rowHeight: MOD_ROW_HEIGHT,
    overscan: 14,
    enabled: displayedMods.length > MOD_VIRTUALIZATION_THRESHOLD,
  })

  const visibleMods = useMemo(
    () => displayedMods.slice(
      virtualizedMods.startIndex,
      Math.min(virtualizedMods.endIndex, displayedMods.length)
    ),
    [displayedMods, virtualizedMods.endIndex, virtualizedMods.startIndex]
  )
  const showAppendInstallRow = hasAppendInstallRow &&
    virtualizedMods.startIndex <= displayedMods.length &&
    virtualizedMods.endIndex > displayedMods.length

  const sortStateFor = (key: LibrarySortKey): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== key) return 'none'
    return sortDirection === 'asc' ? 'ascending' : 'descending'
  }

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => orderedEntryIds.has(id)))
  }, [orderedEntryIds])

  useEffect(() => {
    if (!renamingModId) return
    const renamedMod = orderedEntries.find((mod) => mod.uuid === renamingModId)
    if (!renamedMod) {
      setRenamingModId(null)
      setRenameValue('')
      return
    }
    setRenameValue(renamedMod.name)
  }, [renamingModId, orderedEntries])

  useEffect(() => {
    const clearSelection = (event: MouseEvent) => {
      if (event.button !== 0 || selectedIds.length === 0) return

      const target = event.target as HTMLElement | null
      if (target?.closest('[data-mod-row="true"]')) return
      if (target?.closest('[data-bulk-actions="true"]')) return
      if (target?.closest('[data-action-prompt="true"]')) return

      setSelectedIds([])
      setSelectionAnchorId(null)
      selectMod(null)
    }

    window.addEventListener('mousedown', clearSelection)
    return () => window.removeEventListener('mousedown', clearSelection)
  }, [selectedIds.length, selectMod])

  useEffect(() => {
    const handleSelectAll = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isEditable = Boolean(
        target?.closest('input, textarea, [contenteditable="true"]')
      )

      if (isEditable) return
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return

      event.preventDefault()
      const visibleIds = displayedMods.filter((mod) => mod.kind === 'mod').map((mod) => mod.uuid)
      setSelectedIds(visibleIds)
      setSelectionAnchorId(visibleIds[0] ?? null)
    }

    window.addEventListener('keydown', handleSelectAll)
    return () => window.removeEventListener('keydown', handleSelectAll)
  }, [displayedMods])

  useEffect(() => {
    if (!filterOpen) return
    const close = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [filterOpen])

  useEffect(() => {
    if (!moveSeparatorMenuOpen) return
    const close = (event: MouseEvent) => {
      if (!moveSeparatorMenuRef.current?.contains(event.target as Node)) {
        setMoveSeparatorMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [moveSeparatorMenuOpen])

  useEffect(() => {
    if (!libraryDeleteAllRequestedAt) return
    setPendingAction({ type: 'delete-all', count: orderedEntries.length })
    clearLibraryDeleteAllRequest()
  }, [clearLibraryDeleteAllRequest, libraryDeleteAllRequestedAt, orderedEntries.length])

  useEffect(() => {
    if (selectedModCount === 0 || sortKey !== null) {
      setMoveSeparatorMenuOpen(false)
    }
  }, [selectedModCount, sortKey])

  useEffect(() => {
    const validSeparatorIds = new Set(allSeparators.map((separator) => separator.uuid))
    setCollapsedSeparatorIds((current) => current.filter((id) => validSeparatorIds.has(id)))
  }, [allSeparators])

  useEffect(() => () => {
    if (separatorRevealTimeoutRef.current !== null) {
      window.clearTimeout(separatorRevealTimeoutRef.current)
    }
  }, [])

  const revealSeparator = useCallback((separatorId: string) => {
    setCollapsedSeparatorIds((current) => current.filter((id) => id !== separatorId))
    setRecentlyRevealedSeparatorId(separatorId)

    if (separatorRevealTimeoutRef.current !== null) {
      window.clearTimeout(separatorRevealTimeoutRef.current)
    }

    separatorRevealTimeoutRef.current = window.setTimeout(() => {
      setRecentlyRevealedSeparatorId((current) => (current === separatorId ? null : current))
      separatorRevealTimeoutRef.current = null
    }, 220)
  }, [])

  const handleInstallFile = useCallback(async (filePath: string) => {
    if (!hasRequiredPaths) {
      addToast('Set Game Path and Mod Library before installing mods', 'warning')
      setActiveView('settings')
      return
    }

    const installResult = await installMod(filePath)
    if (!installResult.ok || !installResult.data) {
      addToast(installResult.error ?? 'Install failed', 'error')
      return
    }

    if (installResult.data.status === 'installed' && installResult.data.mod) {
      await finalizeInstalledMod(installResult.data.mod, `${installResult.data.mod.name} installed & activated`)
      return
    }

    if (installResult.data.status === 'conflict') {
      addToast('File conflicts detected during install', 'warning')
    }
  }, [installMod, finalizeInstalledMod, addToast, hasRequiredPaths, setActiveView])

  const handleInstallClick = async () => {
    const result = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(
      IPC.OPEN_FILE_DIALOG,
      {
        title: 'Select Mod Archive',
        filters: [{ name: 'Mod Archives', extensions: ['zip'] }],
        properties: ['openFile'],
      }
    )
    if (result.canceled || !result.filePaths.length) return
    await handleInstallFile(result.filePaths[0])
  }

  const handleSort = (nextKey: LibrarySortKey) => {
    if (sortKey === nextKey) {
      if (sortDirection === 'asc') {
        setSortDirection('desc')
      } else {
        setSortKey(null)
      }
      return
    }

    setSortKey(nextKey)
    setSortDirection('asc')
  }

  const moveModsToSeparator = useCallback(async (modIds: string[], separatorId: string) => {
    if (sortKey !== null) {
      addToast('Return to Custom Order to move mods between separators', 'warning')
      return
    }

    const movingIds = modIds.filter((id, index, list) =>
      list.indexOf(id) === index && allMods.some((mod) => mod.uuid === id)
    )
    if (movingIds.length === 0) return

    const movingSet = new Set(movingIds)
    const movingEntries = orderedEntries.filter((entry) => movingSet.has(entry.uuid))
    const remainingEntries = orderedEntries.filter((entry) => !movingSet.has(entry.uuid))
    const separatorIndex = remainingEntries.findIndex((entry) => entry.uuid === separatorId && entry.kind === 'separator')

    if (separatorIndex < 0) return

    let insertIndex = separatorIndex + 1
    while (insertIndex < remainingEntries.length && remainingEntries[insertIndex].kind !== 'separator') {
      insertIndex += 1
    }

    const reordered = [
      ...remainingEntries.slice(0, insertIndex),
      ...movingEntries,
      ...remainingEntries.slice(insertIndex),
    ]

    await useAppStore.getState().reorderMods(reordered.map((entry) => entry.uuid))
    revealSeparator(separatorId)
    addToast(
      `${movingIds.length} mod${movingIds.length === 1 ? '' : 's'} moved into ${orderedEntries.find((entry) => entry.uuid === separatorId)?.name ?? 'separator'}`,
      'success',
      1800
    )
  }, [addToast, allMods, orderedEntries, revealSeparator, sortKey])

  const moveModsToTopLevel = useCallback(async (modIds: string[]) => {
    if (sortKey !== null) {
      addToast('Return to Custom Order to move mods out of separators', 'warning')
      return
    }

    const movingIds = modIds.filter((id, index, list) =>
      list.indexOf(id) === index && allMods.some((mod) => mod.uuid === id)
    )
    if (movingIds.length === 0) return

    const movingSet = new Set(movingIds)
    const movingEntries = orderedEntries.filter((entry) => movingSet.has(entry.uuid))
    const remainingEntries = orderedEntries.filter((entry) => !movingSet.has(entry.uuid))
    const firstSeparatorIndex = remainingEntries.findIndex((entry) => entry.kind === 'separator')
    const insertIndex = firstSeparatorIndex >= 0 ? firstSeparatorIndex : remainingEntries.length

    const reordered = [
      ...remainingEntries.slice(0, insertIndex),
      ...movingEntries,
      ...remainingEntries.slice(insertIndex),
    ]

    await useAppStore.getState().reorderMods(reordered.map((entry) => entry.uuid))
    addToast(
      `${movingIds.length} mod${movingIds.length === 1 ? '' : 's'} moved back to top level`,
      'success',
      1800
    )
  }, [addToast, allMods, orderedEntries, sortKey])

  const handleMoveSelectedToSeparator = useCallback(async (separatorId: string) => {
    await moveModsToSeparator(selectedModIds, separatorId)
    setMoveSeparatorMenuOpen(false)
  }, [moveModsToSeparator, selectedModIds])

  const handleMoveSelectedToTopLevel = useCallback(async () => {
    if (selectedModIds.length === 0) return
    await moveModsToTopLevel(selectedModIds)
    setContextMenu(null)
  }, [moveModsToTopLevel, selectedModIds])

  const handleCreateSeparator = useCallback((insertIndex?: number) => {
    const allowIndexedInsert = sortKey === null

    if (sortKey !== null) {
      setSortKey(null)
      setSortDirection('asc')
    }

    setSeparatorDialogSubmitting(false)
    setSeparatorDialog({
      mode: 'create',
      value: '',
      insertIndex: allowIndexedInsert ? insertIndex : undefined,
    })
  }, [sortKey])

  const handleSubmitSeparatorDialog = useCallback(async () => {
    if (!separatorDialog) return

    const trimmed = separatorDialog.value.trim()
    if (!trimmed) {
      addToast('Separator name cannot be empty', 'warning')
      return
    }

    setSeparatorDialogSubmitting(true)

    if (separatorDialog.mode === 'create') {
      const created = await createSeparator(trimmed)
      if (!created) {
        setSeparatorDialogSubmitting(false)
        addToast('Could not create separator', 'error')
        return
      }

      await scanMods()
      await insertSeparatorAtDisplayIndex(created.uuid, separatorDialog.insertIndex)
      setSeparatorDialogSubmitting(false)
      setSeparatorDialog(null)
      setSelectedIds([])
      selectedIdsRef.current = []
      setSelectionAnchorId(null)
      selectionAnchorIdRef.current = null
      selectMod(created.uuid)
      addToast('Separator created', 'success', 1600)
      return
    }

    if (!separatorDialog.separatorId) {
      setSeparatorDialogSubmitting(false)
      return
    }

    await updateModMetadata(separatorDialog.separatorId, { name: trimmed })
    setSeparatorDialogSubmitting(false)
    setSeparatorDialog(null)
    addToast('Separator name updated', 'success', 1600)
  }, [addToast, createSeparator, insertSeparatorAtDisplayIndex, scanMods, selectMod, separatorDialog, updateModMetadata])

  const clearInternalDragState = useCallback(() => {
    draggedModIdsRef.current = []
    setDraggedModIds([])
    setRowDropTarget(null)
    setDropSeparatorId(null)
    setTopLevelDropActive(false)
  }, [])

  const getDraggedIdsFromEvent = useCallback((event: React.DragEvent): string[] => {
    const rawIds = event.dataTransfer.getData(INTERNAL_MOD_DRAG_TYPE)
    if (rawIds) {
      try {
        const parsed = JSON.parse(rawIds) as string[]
        if (Array.isArray(parsed)) return parsed
      } catch {
        // fall back to local drag state
      }
    }

    return draggedModIdsRef.current
  }, [])

  const reorderModsAroundTarget = useCallback(async (
    modIds: string[],
    targetId: string,
    position: 'before' | 'after'
  ) => {
    if (sortKey !== null) {
      addToast('Return to Custom Order to reorder mods manually', 'warning')
      return
    }

    const movingIds = modIds.filter((id, index, list) =>
      list.indexOf(id) === index && orderedEntries.some((entry) => entry.uuid === id)
    )
    if (movingIds.length === 0 || movingIds.includes(targetId)) return

    const movingSet = new Set(movingIds)
    const movingEntries = orderedEntries.filter((entry) => movingSet.has(entry.uuid))
    const remainingEntries = orderedEntries.filter((entry) => !movingSet.has(entry.uuid))
    const targetIndex = remainingEntries.findIndex((entry) => entry.uuid === targetId)
    if (targetIndex < 0) return

    const insertIndex = targetIndex + (position === 'after' ? 1 : 0)
    const reordered = [
      ...remainingEntries.slice(0, insertIndex),
      ...movingEntries,
      ...remainingEntries.slice(insertIndex),
    ]

    await useAppStore.getState().reorderMods(reordered.map((entry) => entry.uuid))
  }, [addToast, orderedEntries, sortKey])

  const handleRowDragStart = useCallback((event: React.DragEvent, mod: ModMetadata) => {
    if (sortKey !== null) {
      event.preventDefault()
      return
    }

    const nextIds = selectedIdsRef.current.includes(mod.uuid)
      ? expandSelectionWithSeparatorBlocks(selectedIdsRef.current)
      : mod.kind === 'separator'
        ? getSeparatorBlockIds(mod.uuid)
        : [mod.uuid]

    selectedIdsRef.current = nextIds
    setSelectedIds(nextIds)
    selectionAnchorIdRef.current = nextIds[0] ?? null
    setSelectionAnchorId(nextIds[0] ?? null)
    selectMod(mod.uuid)
    draggedModIdsRef.current = nextIds
    setDraggedModIds(nextIds)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(INTERNAL_MOD_DRAG_TYPE, JSON.stringify(nextIds))
    event.dataTransfer.setData('text/plain', nextIds.join(','))
  }, [expandSelectionWithSeparatorBlocks, getSeparatorBlockIds, selectMod, sortKey])

  const handleRowDragEnd = useCallback(() => {
    clearInternalDragState()
  }, [clearInternalDragState])

  const handleModRowDragOver = useCallback((event: React.DragEvent, targetMod: ModMetadata) => {
    if (targetMod.kind !== 'mod' || sortKey !== null) return

    const movingIds = getDraggedIdsFromEvent(event)
    if (movingIds.length === 0 || movingIds.includes(targetMod.uuid)) return

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'

    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
    const position: 'before' | 'after' = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

    if (!rowDropTarget || rowDropTarget.targetId !== targetMod.uuid || rowDropTarget.position !== position) {
      setRowDropTarget({ targetId: targetMod.uuid, position })
    }
    if (dropSeparatorId !== null) setDropSeparatorId(null)
    if (topLevelDropActive) setTopLevelDropActive(false)
  }, [dropSeparatorId, getDraggedIdsFromEvent, rowDropTarget, sortKey, topLevelDropActive])

  const handleModRowDragLeave = useCallback((event: React.DragEvent, targetMod: ModMetadata) => {
    if (!rowDropTarget || rowDropTarget.targetId !== targetMod.uuid) return
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setRowDropTarget(null)
    }
  }, [rowDropTarget])

  const handleModRowDrop = useCallback(async (event: React.DragEvent, targetMod: ModMetadata) => {
    if (targetMod.kind !== 'mod') return

    event.preventDefault()
    event.stopPropagation()

    const movingIds = getDraggedIdsFromEvent(event)
    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
    const position: 'before' | 'after' = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

    await reorderModsAroundTarget(movingIds, targetMod.uuid, position)
    clearInternalDragState()
  }, [clearInternalDragState, getDraggedIdsFromEvent, reorderModsAroundTarget])

  const handleSeparatorDragOver = useCallback((event: React.DragEvent, separator: ModMetadata) => {
    if (separator.kind !== 'separator' || sortKey !== null) return
    const movingIds = getDraggedIdsFromEvent(event)
    if (movingIds.length === 0) return

    const draggingSeparatorBlock = movingIds.some((id) => {
      const entry = orderedEntries.find((candidate) => candidate.uuid === id)
      return entry?.kind === 'separator'
    })

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'

    if (draggingSeparatorBlock) {
      const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
      const position: 'before' | 'after' = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

      if (!rowDropTarget || rowDropTarget.targetId !== separator.uuid || rowDropTarget.position !== position) {
        setRowDropTarget({ targetId: separator.uuid, position })
      }
      if (dropSeparatorId !== null) setDropSeparatorId(null)
      if (topLevelDropActive) setTopLevelDropActive(false)
      return
    }

    if (dropSeparatorId !== separator.uuid) {
      setDropSeparatorId(separator.uuid)
    }
    if (rowDropTarget !== null) setRowDropTarget(null)
    if (topLevelDropActive) setTopLevelDropActive(false)
  }, [dropSeparatorId, getDraggedIdsFromEvent, orderedEntries, rowDropTarget, sortKey, topLevelDropActive])

  const handleSeparatorDragLeave = useCallback((event: React.DragEvent, separator: ModMetadata) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      if (dropSeparatorId === separator.uuid) {
        setDropSeparatorId(null)
      }
      if (rowDropTarget?.targetId === separator.uuid) {
        setRowDropTarget(null)
      }
    }
  }, [dropSeparatorId, rowDropTarget])

  const handleSeparatorDrop = useCallback(async (event: React.DragEvent, separator: ModMetadata) => {
    event.preventDefault()
    event.stopPropagation()

    const parsedIds = getDraggedIdsFromEvent(event)
    const draggingSeparatorBlock = parsedIds.some((id) => {
      const entry = orderedEntries.find((candidate) => candidate.uuid === id)
      return entry?.kind === 'separator'
    })

    if (draggingSeparatorBlock) {
      const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
      const position: 'before' | 'after' = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      await reorderModsAroundTarget(parsedIds, separator.uuid, position)
    } else {
      await moveModsToSeparator(parsedIds, separator.uuid)
    }
    clearInternalDragState()
  }, [clearInternalDragState, getDraggedIdsFromEvent, moveModsToSeparator, orderedEntries, reorderModsAroundTarget])

  const handleTopLevelDragOver = useCallback((event: React.DragEvent) => {
    if (sortKey !== null) return

    const movingIds = getDraggedIdsFromEvent(event)
    if (movingIds.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (!topLevelDropActive) setTopLevelDropActive(true)
    if (rowDropTarget !== null) setRowDropTarget(null)
    if (dropSeparatorId !== null) setDropSeparatorId(null)
  }, [dropSeparatorId, getDraggedIdsFromEvent, rowDropTarget, sortKey, topLevelDropActive])

  const handleTopLevelDragLeave = useCallback((event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setTopLevelDropActive(false)
    }
  }, [])

  const handleTopLevelDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    const movingIds = getDraggedIdsFromEvent(event)
    await moveModsToTopLevel(movingIds)
    clearInternalDragState()
  }, [clearInternalDragState, getDraggedIdsFromEvent, moveModsToTopLevel])

  const handleDragOver = (event: React.DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    if (!isDragging) setIsDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }

  const handleDrop = async (event: React.DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) {
      setDropSeparatorId(null)
      setDraggedModIds([])
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)

    const files = Array.from(event.dataTransfer.files)
    const zipFile = files.find((file) => file.name.toLowerCase().endsWith('.zip'))
    if (!zipFile) {
      addToast('Drop a .zip mod archive to install', 'warning')
      return
    }

    const filePath = (zipFile as unknown as { path: string }).path
    await handleInstallFile(filePath)
  }

  const handleRowContextMenu = (event: React.MouseEvent, mod: ModMetadata) => {
    event.preventDefault()
    event.stopPropagation()
    selectMod(mod.uuid)
    setContextMenu({ kind: 'row', mod, x: event.clientX, y: event.clientY })
  }

  const handleListContextMenu = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-mod-row="true"]')) return

    event.preventDefault()
    event.stopPropagation()

    const rect = listRowsRef.current?.getBoundingClientRect()
    const localY = rect ? Math.max(0, event.clientY - rect.top) : 0
    const insertIndex = Math.max(0, Math.min(Math.floor(localY / MOD_ROW_HEIGHT), displayedMods.length))
    setContextMenu({ kind: 'list', x: event.clientX, y: event.clientY, insertIndex })
  }, [displayedMods.length, selectMod])

  const handleContextCreateSeparator = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'list') return
    handleCreateSeparator(contextMenu.insertIndex)
    setContextMenu(null)
  }, [contextMenu, handleCreateSeparator])

  const handleContextCreateSeparatorAtEnd = useCallback(() => {
    handleCreateSeparator(displayedMods.length)
    setContextMenu(null)
  }, [displayedMods.length, handleCreateSeparator])

  const handleContextCreateSeparatorBeforeRow = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'row') return

    const rowIndex = displayedMods.findIndex((entry) => entry.uuid === contextMenu.mod.uuid)
    handleCreateSeparator(rowIndex >= 0 ? rowIndex : undefined)
    setContextMenu(null)
  }, [contextMenu, displayedMods, handleCreateSeparator])

  const handleRefreshLibrary = useCallback(async () => {
    setContextMenu(null)
    await scanMods()
    addToast('Library refreshed', 'success', 1200)
  }, [addToast, scanMods])

  const handleToggleAllSeparators = useCallback(() => {
    if (allSeparatorIds.length === 0) return

    setCollapsedSeparatorIds(hasCollapsedSeparators ? [] : allSeparatorIds)
    setContextMenu(null)
  }, [allSeparatorIds, hasCollapsedSeparators])

  const handleFilterChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(event.target.value)
  }

  const handleListRowsDragOver = useCallback((event: React.DragEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-mod-row="true"]')) return
    if (sortKey !== null) return

    const movingIds = getDraggedIdsFromEvent(event)
    if (movingIds.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (!topLevelDropActive) setTopLevelDropActive(true)
    if (rowDropTarget !== null) setRowDropTarget(null)
    if (dropSeparatorId !== null) setDropSeparatorId(null)
  }, [dropSeparatorId, getDraggedIdsFromEvent, rowDropTarget, sortKey, topLevelDropActive])

  const handleListRowsDragLeave = useCallback((event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setTopLevelDropActive(false)
    }
  }, [])

  const handleListRowsDrop = useCallback(async (event: React.DragEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-mod-row="true"]')) return

    if (sortKey !== null) return

    event.preventDefault()
    event.stopPropagation()

    const movingIds = getDraggedIdsFromEvent(event)
    await moveModsToTopLevel(movingIds)
    clearInternalDragState()
  }, [clearInternalDragState, getDraggedIdsFromEvent, moveModsToTopLevel, sortKey])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const el = contextMenuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = contextMenu.x
    let y = contextMenu.y
    if (x + rect.width > vw - 8) x = vw - rect.width - 8
    if (y + rect.height > vh - 8) y = vh - rect.height - 8
    if (x < 8) x = 8
    if (y < 8) y = 8
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }, [contextMenu])

  const handleRowSelect = useCallback((event: React.MouseEvent, mod: ModMetadata, index: number) => {
    const currentDisplayedMods = displayedModsRef.current
    const currentSelectedIds = selectedIdsRef.current
    const currentSelectionAnchorId = selectionAnchorIdRef.current
    const resolvedAnchorId = currentSelectionAnchorId ?? currentSelectedIds[0] ?? null
    const anchorIndex = resolvedAnchorId
      ? currentDisplayedMods.findIndex((item) => item.uuid === resolvedAnchorId)
      : -1

    if (mod.kind === 'separator' && !(event.shiftKey || event.ctrlKey || event.metaKey)) {
      if (collapsedSeparatorSet.has(mod.uuid)) {
        revealSeparator(mod.uuid)
      } else {
        setCollapsedSeparatorIds((current) => [...current, mod.uuid])
      }
      selectedIdsRef.current = [mod.uuid]
      setSelectedIds([mod.uuid])
      setSelectionAnchorId(mod.uuid)
      selectionAnchorIdRef.current = mod.uuid
      selectMod(mod.uuid)
      return
    }

    if (event.shiftKey && anchorIndex >= 0) {
      const start = Math.min(anchorIndex, index)
      const end = Math.max(anchorIndex, index)
      const rangeIds = currentDisplayedMods
        .slice(start, end + 1)
        .map((item) => item.uuid)

      selectedIdsRef.current = rangeIds
      setSelectedIds(rangeIds)
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedIds((current) =>
        {
          const next = current.includes(mod.uuid)
            ? current.filter((id) => id !== mod.uuid)
            : [...current, mod.uuid]
          selectedIdsRef.current = next
          return next
        }
      )
      if (!currentSelectionAnchorId && currentSelectedIds.length === 0) {
        selectionAnchorIdRef.current = mod.uuid
        setSelectionAnchorId(mod.uuid)
      }
    } else {
      selectedIdsRef.current = [mod.uuid]
      selectionAnchorIdRef.current = mod.uuid
      setSelectedIds([mod.uuid])
      setSelectionAnchorId(mod.uuid)
    }

    selectMod(mod.uuid)
  }, [collapsedSeparatorSet, revealSeparator, selectMod])

  const runBulkToggle = useCallback(async (modIds: string[], target: 'enable' | 'disable') => {
    const actionableIds = modIds.filter((id) => {
      const mod = allMods.find((item) => item.uuid === id)
      if (!mod) return false
      return target === 'enable' ? !mod.enabled : mod.enabled
    })

    if (actionableIds.length === 0) {
      addToast(target === 'enable' ? 'No mods to enable' : 'No mods to disable', 'info')
      return
    }

    let failed = 0

    for (const modId of actionableIds) {
      const result = target === 'enable' ? await enableMod(modId) : await disableMod(modId)
      if (!result.ok) failed += 1
    }

    const changed = actionableIds.length - failed
    if (changed > 0) {
      addToast(
        `${changed} mod${changed === 1 ? '' : 's'} ${target === 'enable' ? 'enabled' : 'disabled'}`,
        'success'
      )
    }
    if (failed > 0) {
      addToast(`${failed} mod${failed === 1 ? '' : 's'} failed to ${target}`, 'warning')
    }
  }, [allMods, addToast, enableMod, disableMod])

  const handleDeleteAll = useCallback(async () => {
    const targets = [...orderedEntries]
    if (targets.length === 0) {
      addToast('No library entries to delete', 'info')
      return
    }

    setSubmittingAction(true)
    let removed = 0
    let failed = 0

    for (const mod of targets) {
      markRowsDeleting([mod.uuid])
      const result = await deleteMod(mod.uuid)
      if (result.ok) {
        removed += 1
      } else {
        failed += 1
      }
      clearDeletingRows([mod.uuid])
    }

    setSubmittingAction(false)
    setPendingAction(null)
    setSelectedIds([])
    setSelectionAnchorId(null)

    if (removed > 0) {
      addToast(`${removed} librar${removed === 1 ? 'y entry' : 'y entries'} deleted`, 'success')
    }
    if (failed > 0) {
      addToast(`${failed} librar${failed === 1 ? 'y entry' : 'y entries'} could not be deleted`, 'warning')
    }
  }, [addToast, clearDeletingRows, deleteMod, markRowsDeleting, orderedEntries])

  const handleDeleteSelected = useCallback(async (modIds: string[]) => {
    const targets = allMods.filter((mod) => modIds.includes(mod.uuid))
    if (targets.length === 0) {
      setPendingAction(null)
      addToast('No selected mods to delete', 'info')
      return
    }

    setSubmittingAction(true)
    let removed = 0
    let failed = 0

    for (const mod of targets) {
      markRowsDeleting([mod.uuid])
      const result = await deleteMod(mod.uuid)
      if (result.ok) {
        removed += 1
      } else {
        failed += 1
      }
      clearDeletingRows([mod.uuid])
    }

    setSubmittingAction(false)
    setPendingAction(null)
    setSelectedIds([])
    setSelectionAnchorId(null)

    if (removed > 0) {
      addToast(`${removed} mod${removed === 1 ? '' : 's'} deleted from selection`, 'success')
    }
    if (failed > 0) {
      addToast(`${failed} mod${failed === 1 ? '' : 's'} could not be deleted`, 'warning')
    }
  }, [allMods, addToast, clearDeletingRows, deleteMod, markRowsDeleting])

  const handleContextEnable = async () => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.mod.kind !== 'mod') return
    const result = await enableMod(contextMenu.mod.uuid)
    if (!result.ok) addToast(result.error ?? 'Enable failed', 'error')
    setContextMenu(null)
  }

  const handleContextDisable = async () => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.mod.kind !== 'mod') return
    const result = await disableMod(contextMenu.mod.uuid)
    if (!result.ok) addToast(result.error ?? 'Disable failed', 'error')
    setContextMenu(null)
  }

  const handleContextOpenFolder = async () => {
    if (!contextMenu || contextMenu.kind !== 'row' || !settings?.libraryPath) return
    const modPath = `${settings.libraryPath}\\${contextMenu.mod.folderName ?? contextMenu.mod.uuid}`
    await IpcService.invoke(IPC.OPEN_PATH, modPath)
    setContextMenu(null)
  }

  const handleContextOpenOnNexus = async () => {
    if (!contextMenu || contextMenu.kind !== 'row') return
    const mod = contextMenu.mod
    const modId = mod.nexusModId ?? mod.nexusFileId
    if (!modId) {
      addToast('No Nexus link stored for this mod', 'warning')
      setContextMenu(null)
      return
    }

    const url = `https://www.nexusmods.com/cyberpunk2077/mods/${mod.nexusModId ?? mod.nexusFileId}`
    await IpcService.invoke(IPC.OPEN_EXTERNAL, url)
    setContextMenu(null)
  }

  const handleDeleteMod = async (mod: ModMetadata) => {
    markRowsDeleting([mod.uuid])
    const result = await deleteMod(mod.uuid)
    clearDeletingRows([mod.uuid])
    if (!result.ok) {
      addToast(result.error ?? 'Delete failed', 'error')
    } else {
      addToast(`${mod.name} deleted`, 'success')
    }
  }

  const handleContextDelete = async () => {
    if (!contextMenu || contextMenu.kind !== 'row') return
    setPendingDeleteMod(contextMenu.mod)
    setContextMenu(null)
  }

  const handleContextRename = () => {
    if (!contextMenu || contextMenu.kind !== 'row') return
    setRenamingModId(contextMenu.mod.uuid)
    setRenameValue(contextMenu.mod.name)
    setContextMenu(null)
  }

  const handleContextDetails = () => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.mod.kind !== 'mod') return
    setDetailOverlay({ modId: contextMenu.mod.uuid })
    setContextMenu(null)
  }

  const handleContextReinstall = async () => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.mod.kind !== 'mod') return
    if (!contextMenu.mod.sourcePath) {
      addToast('Original source is not stored for this mod', 'warning')
      setContextMenu(null)
      return
    }

    openReinstallPrompt(contextMenu.mod)

    setContextMenu(null)
  }

  const getContextTargetModIds = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.mod.kind !== 'mod') return []
    return selectedModIds.includes(contextMenu.mod.uuid) ? selectedModIds : [contextMenu.mod.uuid]
  }, [contextMenu, selectedModIds])

  const handleContextMoveSelectedHere = async () => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.mod.kind !== 'separator') return
    await moveModsToSeparator(selectedModIds, contextMenu.mod.uuid)
    setContextMenu(null)
  }

  const handleContextMoveToTopLevel = async () => {
    const targetIds = getContextTargetModIds()
    if (targetIds.length === 0) return
    await moveModsToTopLevel(targetIds)
    setContextMenu(null)
  }

  const handleStartRename = (mod: ModMetadata) => {
    setRenamingModId(mod.uuid)
    setRenameValue(mod.name)
  }

  const handleSaveRename = async () => {
    if (!renamingModId) return

    const trimmed = renameValue.trim()
    if (!trimmed) {
      addToast('Mod name cannot be empty', 'warning')
      return
    }

    await updateModMetadata(renamingModId, { name: trimmed })
    addToast('Mod name updated', 'success', 1800)
    setRenamingModId(null)
    setRenameValue('')
  }

  const handleCancelRename = () => {
    setRenamingModId(null)
    setRenameValue('')
  }

  const browseLikeButtonClass = 'flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border-[0.5px] px-4 text-[10px] brand-font font-bold uppercase tracking-widest transition-colors'
  const darkBrowseLikeButtonClass = `${browseLikeButtonClass} border-[#fcee09]/50 bg-[#0a0a0a] text-[#fcee09] hover:bg-[#fcee09] hover:text-[#050505]`
  const activeBrowseLikeButtonClass = `${browseLikeButtonClass} border-[#fcee09] bg-[#fcee09] text-[#050505]`
  const destructiveButtonClass = `${browseLikeButtonClass} border-[#5b1818] bg-[#160707] text-[#f18d8d] hover:border-[#f87171] hover:bg-[#2a0909] hover:text-[#ffe1e1]`
  const disabledBrowseLikeButtonClass = `${browseLikeButtonClass} cursor-not-allowed border-[#303030] bg-[#131313] text-[#666666] shadow-none`

  const renderInstallRow = (nestedRow = false) => (
    <div className={`relative ${nestedRow ? 'pl-6' : ''}`}>
      {nestedRow ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-[12px] top-0 w-px"
          style={{
            background: 'linear-gradient(180deg, rgba(79,216,255,0.12), rgba(79,216,255,0.34), rgba(79,216,255,0.12))',
          }}
        />
      ) : null}
      <div
        className="relative h-[38px] overflow-hidden border-b-[0.5px]"
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
          className="relative z-10 grid h-[38px] gap-4 pl-5 pr-5 py-[5px]"
          style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
        >
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 flex items-center justify-center rounded-sm border-[0.5px]" style={{ borderColor: `${installAppearance.accent}22`, background: `${installAppearance.accent}08` }}>
                <span className="material-symbols-outlined" style={{ color: installAppearance.accent }}>progress_activity</span>
              </div>
            </div>
          </div>
          <div className="flex items-center text-[12px] font-mono text-[#9a9a9a]">
            ...
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium tracking-tight truncate text-[#e5e2e1]">
                {installDisplayName}
              </span>
              <span
                className="shrink-0 rounded-sm border-[0.5px] px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest"
                style={{
                  color: installAppearance.accent,
                  borderColor: `${installAppearance.accent}55`,
                  background: `${installAppearance.accent}12`,
                }}
              >
                {installAppearance.label}
              </span>
            </div>
            <span
              className="truncate text-sm font-mono tracking-tight"
              style={{ color: installAppearance.accent }}
            >
              {installCurrentFile || installAppearance.detailFallback}
            </span>
          </div>
          <div className="flex items-center text-sm font-mono tracking-tight text-[#d8d8d8]">
            {installProgress > 0 ? `${installProgress}%` : '...'}
          </div>
          <div className="flex items-center">
            <span
              className="px-2.5 py-[3px] border-[0.5px] text-[10px] uppercase tracking-widest rounded-sm"
              style={{
                color: installAppearance.accent,
                borderColor: `${installAppearance.accent}40`,
                background: '#0a0a0a',
              }}
            >
              {installAppearance.label}
            </span>
          </div>
          <div className="flex items-center text-sm font-mono tracking-tight text-[#d8d8d8]">
            {installStatus || installAppearance.summary}
          </div>
          <div className="flex items-center justify-end">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] bg-[#0a0a0a]/90"
              style={{
                borderColor: `${installAppearance.accent}44`,
                color: installAppearance.accent,
              }}
            >
              <span className="material-symbols-outlined animate-spin text-[15px]">progress_activity</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderDeleteRow = (mod: ModMetadata, nestedRow = false) => {
    const startedAt = deletingRows[mod.uuid]?.startedAt ?? deleteProgressTick
    const deleteProgress = getTransientDeleteProgress(startedAt, deleteProgressTick)
    const deleteLabel = mod.kind === 'separator' ? 'Deleting separator' : 'Deleting mod'
    const deleteSummary = mod.kind === 'separator'
      ? 'Removing separator from library'
      : 'Removing files from disk'

    return (
      <div className={`relative ${nestedRow ? 'pl-6' : ''}`}>
        {nestedRow ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-[12px] top-0 w-px"
            style={{
              background: 'linear-gradient(180deg, rgba(79,216,255,0.12), rgba(79,216,255,0.34), rgba(79,216,255,0.12))',
            }}
          />
        ) : null}
        <div
          className="relative h-[38px] overflow-hidden border-b-[0.5px]"
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
            className="relative z-10 grid h-[38px] gap-4 pl-5 pr-5 py-[5px]"
            style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
          >
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px]" style={{ borderColor: `${deleteAppearance.accent}22`, background: `${deleteAppearance.accent}08` }}>
                <span className="material-symbols-outlined animate-spin text-[15px]" style={{ color: deleteAppearance.accent }}>progress_activity</span>
              </div>
            </div>
            <div className="flex items-center text-[12px] font-mono text-[#d8d8d8]">
              {mod.kind === 'separator' ? '...' : loadOrderMap.get(mod.uuid) ?? '...'}
            </div>
            <div className="flex min-w-0 items-center gap-2 overflow-hidden">
              <span className="font-medium tracking-tight truncate text-[#ffe1e1]">
                {mod.name}
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
            <div className="flex items-center text-sm font-mono tracking-tight text-[#d8d8d8]">
              {deleteProgress > 0 ? `${deleteProgress}%` : '...'}
            </div>
            <div className="flex items-center">
              <span
                className="px-2.5 py-[3px] border-[0.5px] text-[10px] uppercase tracking-widest rounded-sm truncate"
                style={{
                  color: deleteAppearance.accent,
                  borderColor: `${deleteAppearance.accent}40`,
                  background: '#0a0a0a',
                }}
              >
                {mod.kind === 'separator' ? 'Deleting' : 'Deleting mod'}
              </span>
            </div>
            <div className="flex items-center min-w-0 text-sm font-mono tracking-tight text-[#ffb4ab]">
              <span className="truncate">{deleteSummary}</span>
            </div>
            <div className="flex items-center justify-end">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] bg-[#0a0a0a]/90"
                style={{
                  borderColor: `${deleteAppearance.accent}44`,
                  color: deleteAppearance.accent,
                }}
              >
                <span className="material-symbols-outlined animate-spin text-[15px]">delete</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full animate-settings-in">
    <div
      className="flex flex-col h-full overflow-hidden relative select-none"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#050505]/90 border-[1px] border-[#fcee09]/40 pointer-events-none">
          <span className="material-symbols-outlined text-[48px] text-[#fcee09] mb-4">file_download</span>
          <span className="brand-font text-sm text-[#fcee09] tracking-widest uppercase">Drop to install mod</span>
        </div>
      )}

      {/* Fixed header — does not scroll */}
      <div className="shrink-0 px-8 pt-6 pb-3 w-full">
        <div className="flex items-center gap-2">
          <Tooltip
            content={"Managed Mods: list of mods managed by the Hyperion library.\nUse the 'Install Mod' button to add a mod. Use 'Reinstall' to reinstall from the original source file."}
            side="bottom"
            variant="help"
          >
            <h1 className="brand-font text-xl text-white font-bold tracking-widest uppercase">
              Managed Mods
            </h1>
          </Tooltip>
          <Tooltip
            content={"QUICK SELECTION:\nClick in a mod and then select another mod while holding shift to select multiple mods.\nCtrl+A to select all mods."}
            side="bottom"
            variant="help"
          >
            <span className="material-symbols-outlined cursor-help text-[16px] text-[#4a4a4a] hover:text-[#7a7a7a] transition-colors mt-0.5">help_outline</span>
          </Tooltip>
          {showCustomOrderBadge && (
            <Tooltip
              content={"Custom Order active.\nDrag a mod onto a separator to group it.\nDrag before/after a row to reorder.\nDrag to the header to move a mod to top-level."}
              side="bottom"
              variant="help"
            >
              <span className="inline-flex h-6 items-center rounded-sm border-[0.5px] border-[#2d2a10] bg-[#090804] px-2.5 text-[10px] brand-font font-bold uppercase tracking-[0.16em] text-[#fcee09]">
                Custom Order
              </span>
            </Tooltip>
          )}
        </div>
        <p className="ui-support-mono mt-1 flex items-center gap-2">
          TOTAL: {totalCount} &nbsp;|&nbsp; ACTIVE: {enabledCount}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="group relative min-w-[300px] flex-1 max-w-[460px]">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6a6a6a] text-[18px] transition-colors group-hover:text-[#e8e8e8] group-focus-within:text-[#fcee09]">search</span>
            <input
              className="h-10 w-full rounded-sm border-[0.5px] border-[#fcee09]/50 bg-[#0a0a0a] py-1.5 pl-10 pr-4 text-sm text-[#e5e2e1] placeholder-[#6f6f6f] transition-all hover:border-[#fcee09]/70 hover:text-[#e8e8e8] focus:border-[#fcee09]/65 focus:outline-none focus:shadow-[0_0_14px_rgba(252,238,9,0.08)]"
              placeholder="Search managed mods..."
              type="text"
              value={filter}
              onChange={handleFilterChange}
            />
          </div>

          <div className="flex items-center gap-2">
            <div ref={filterRef} className="relative">
              <button
                onClick={() => setFilterOpen((v) => !v)}
                className={`group flex h-10 items-center gap-2 rounded-sm border-[0.5px] pl-3 pr-3 text-xs brand-font font-bold uppercase tracking-widest transition-colors ${filterOpen ? 'border-[#fcee09]/50 bg-[#0d0d0d] text-[#fcee09]' : 'border-[#fcee09]/50 bg-[#0a0a0a] text-[#cccccc] hover:border-[#fcee09]/70 hover:text-[#e8e8e8]'}`}
              >
                <span className={`material-symbols-outlined text-[16px] transition-colors ${filterOpen ? 'text-[#fcee09]' : 'text-[#6a6a6a] group-hover:text-[#e8e8e8]'}`}>filter_list</span>
                {libraryStatusFilter === 'all' ? 'All' : libraryStatusFilter === 'enabled' ? 'Enabled' : 'Disabled'}
                <span className={`material-symbols-outlined text-[14px] transition-transform transition-colors duration-150 ${filterOpen ? 'rotate-180 text-[#fcee09]' : 'text-[#6a6a6a] group-hover:text-[#e8e8e8]'}`}>expand_more</span>
              </button>
              {filterOpen && (
                <div className="absolute top-full left-0 mt-1 z-[200] min-w-[130px] rounded-sm border-[0.5px] border-[#222] bg-[#0a0a0a] shadow-[0_8px_24px_rgba(0,0,0,0.6)] py-1">
                  {(['all', 'enabled', 'disabled'] as LibraryStatusFilter[]).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => { setLibraryStatusFilter(opt); setFilterOpen(false) }}
                      className={`flex w-full items-center px-4 py-2.5 text-xs brand-font font-bold uppercase tracking-widest transition-colors ${libraryStatusFilter === opt ? 'text-[#fcee09] bg-[#111]' : 'text-[#9d9d9d] hover:text-[#fcee09] hover:bg-[#0d0d0d]'}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => void handleCreateSeparator()}
              className={`${darkBrowseLikeButtonClass} px-5`}
            >
              Add Separator
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Tooltip content={"Delete all mods from the current library"} side="bottom">
              <button
                onClick={() => requestLibraryDeleteAll()}
                className="flex h-10 w-10 items-center justify-center rounded-sm border-[0.5px] border-[#3a1010] bg-[#0d0404] text-[#f18d8d] transition-colors hover:border-[#f87171] hover:bg-[#1a0505] hover:text-[#ffe1e1]"
                aria-label="Delete all mods"
              >
                <span className="material-symbols-outlined text-[22px]">delete_forever</span>
              </button>
            </Tooltip>

            <button
              onClick={handleInstallClick}
              className="flex h-10 shrink-0 items-center whitespace-nowrap rounded-sm bg-[#fcee09] px-5 text-xs brand-font font-bold uppercase tracking-widest text-[#050505] transition-colors shadow-[0_0_20px_rgba(252,238,9,0.15)] hover:bg-white"
            >
              Install Mod
            </button>
          </div>
        </div>
      </div>

        {/* Table — has its own scroll, toolbar stays fixed above */}
      <div className="flex-1 overflow-hidden px-8 pb-6 w-full">
        <div className="h-full bg-[#050505] rounded-sm border-[0.5px] border-[#1a1a1a] overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.24)]">
          <div ref={listScrollRef} className="hyperion-scrollbar managed-mods-scroll h-full overflow-y-auto">

          {/* Sticky column header — scrolls with content area so columns align with row cells */}
          <div
            className="sticky top-0 z-10 grid gap-4 px-5 border-b-[0.5px] border-[#1a1a1a] bg-[#070707]"
            onDragOver={showCustomOrderBadge ? handleTopLevelDragOver : undefined}
            onDragLeave={showCustomOrderBadge ? handleTopLevelDragLeave : undefined}
            onDrop={showCustomOrderBadge ? handleTopLevelDrop : undefined}
            style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
          >
            {showTopLevelHeaderDrop && (
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 transition-[background-color,box-shadow,border-color] duration-150 ${
                  topLevelDropActive
                    ? 'bg-[#06141a]/94 shadow-[inset_0_0_0_1px_rgba(79,216,255,0.42)]'
                    : 'bg-[#070707]/82 shadow-[inset_0_0_0_1px_rgba(79,216,255,0.16)]'
                }`}
              />
            )}
            {showTopLevelHeaderDrop && (
              <div className="pointer-events-none absolute inset-y-0 right-6 z-20 flex items-center">
                <span
                  className={`rounded-sm border-[0.5px] px-2.5 py-[4px] text-[10px] brand-font font-bold uppercase tracking-[0.16em] transition-colors ${
                    topLevelDropActive
                      ? 'border-[#4fd8ff]/55 bg-[#04141b] text-[#4fd8ff]'
                      : 'border-[#2b2b2b] bg-[#0b0b0b] text-[#8a8a8a]'
                  }`}
                >
                  {topLevelDropActive ? 'Release For Top Level' : 'Drag Here For Top Level'}
                </span>
              </div>
            )}
            <div className="flex h-8 items-center pl-2">
              <Tooltip content={bulkToggleDisabled ? bulkToggleTooltip : isBulkToggling ? 'Applying…' : allVisibleEnabled ? 'Disable all visible mods' : 'Enable all visible mods'}>
                <span className="inline-flex">
                  <button
                    onClick={async () => {
                      if (isBulkToggling) return
                      setIsBulkToggling(true)
                      await runBulkToggle(visibleModIds, allVisibleEnabled ? 'disable' : 'enable')
                      setIsBulkToggling(false)
                    }}
                    disabled={bulkToggleDisabled || isBulkToggling}
                    className={`relative h-4 w-8 rounded-full border-[0.5px] transition-all duration-200 ${
                      bulkToggleDisabled
                        ? 'cursor-not-allowed border-[#1a1a1a] bg-[#0a0a0a]'
                        : isBulkToggling
                          ? 'cursor-wait border-[#fcee09]/50 bg-[#2a2604]'
                          : allVisibleEnabled
                            ? 'border-[#fcee09]/45 bg-[#2a2604] hover:border-[#fcee09]/65'
                            : 'border-[#222] bg-[#111] hover:border-[#333]'
                    }`}
                  >
                    <div className={`absolute top-1/2 h-[12px] w-[12px] -translate-y-1/2 rounded-full transition-all duration-200 ${
                      bulkToggleDisabled
                        ? 'left-[2px] bg-[#2a2a2a]'
                        : allVisibleEnabled
                          ? 'right-[1px] bg-[#fcee09]'
                          : 'left-[2px] bg-[#5a5a5a]'
                    }`} />
                  </button>
                </span>
              </Tooltip>
            </div>
            <div className="flex h-8 items-center justify-start text-sm uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">#</div>
            <button
              onClick={() => handleSort('name')}
              aria-label={`Sort by mod name${sortKey === 'name' ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
              className="flex h-8 w-full items-center justify-start gap-0.5 text-left"
            >
              <span className={`text-sm uppercase tracking-widest brand-font font-bold ${sortKey === 'name' ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'}`}>
                Mod Name
              </span>
              <span className={`material-symbols-outlined text-[8px] leading-none ${sortKey === 'name' ? 'text-[#fcee09]' : 'text-[#727272]'}`} aria-hidden="true">{sortKey === 'name' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span>
            </button>
            <div className="flex h-8 items-center justify-start text-sm uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">Version</div>
            <button
              onClick={() => handleSort('type')}
              aria-label={`Sort by type${sortKey === 'type' ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
              className="flex h-8 w-full items-center justify-start gap-0.5 text-left"
            >
              <span className={`text-sm uppercase tracking-widest brand-font font-bold ${sortKey === 'type' ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'}`}>
                Type
              </span>
              <span className={`material-symbols-outlined text-[8px] leading-none ${sortKey === 'type' ? 'text-[#fcee09]' : 'text-[#727272]'}`} aria-hidden="true">{sortKey === 'type' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span>
            </button>
            <button
              onClick={() => handleSort('installedAt')}
              aria-label={`Sort by installed date${sortKey === 'installedAt' ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
              className="flex h-8 w-full items-center justify-start gap-0.5 text-left"
            >
              <span className={`text-sm uppercase tracking-widest brand-font font-bold ${sortKey === 'installedAt' ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'}`}>
                Date
              </span>
              <span className={`material-symbols-outlined text-[8px] leading-none ${sortKey === 'installedAt' ? 'text-[#fcee09]' : 'text-[#727272]'}`} aria-hidden="true">{sortKey === 'installedAt' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span>
            </button>
            <div className="flex h-8 items-center justify-end text-sm uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">Actions</div>
          </div>

          {/* Rows (inside same scroll container as sticky header) */}
          <div
            ref={listRowsRef}
            onContextMenu={handleListContextMenu}
            onDragOver={handleListRowsDragOver}
            onDragLeave={handleListRowsDragLeave}
            onDrop={handleListRowsDrop}
            style={{ minHeight: 'calc(100% - 32px)' }}
          >
            {displayedMods.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <span className="material-symbols-outlined text-[48px] text-[#7a7a7a]">inventory_2</span>
                <span className="text-[#8a8a8a] text-sm font-mono tracking-tight">
                  {filter
                    ? 'No mods match the search'
                    : totalCount === 0
                      ? 'No mods installed'
                      : libraryStatusFilter === 'disabled' && disabledVisibleCount === 0
                        ? 'No disabled mods'
                        : libraryStatusFilter === 'enabled' && enabledVisibleCount === 0
                          ? 'No enabled mods'
                          : 'No mods available'}
                </span>
                {totalCount === 0 && !filter && (
                  <button
                    onClick={() => setActiveView('downloads')}
                    className="flex items-center gap-2 px-4 py-2 bg-[#fcee09] text-[#050505] rounded-sm text-xs brand-font font-bold uppercase tracking-widest hover:bg-white transition-colors mt-2"
                  >
                    <span className="material-symbols-outlined text-[16px]">download</span>
                    Downloads
                  </button>
                )}
              </div>
            ) : (
              <div
                style={{
                  paddingTop: displayedMods.length > MOD_VIRTUALIZATION_THRESHOLD ? virtualizedMods.paddingTop : 0,
                  paddingBottom: displayedMods.length > MOD_VIRTUALIZATION_THRESHOLD ? virtualizedMods.paddingBottom : 0,
                }}
              >
                {visibleMods.map((mod, visibleIndex) => {
                  const index = virtualizedMods.startIndex + visibleIndex
                  const isDeletingRow = Boolean(deletingRows[mod.uuid])
                  if (installing && installPlacement === 'replace' && mod.uuid === installTargetModId) {
                    return <React.Fragment key={`install-${mod.uuid}`}>{renderInstallRow(installTargetNested)}</React.Fragment>
                  }
                  if (isDeletingRow) {
                    return <React.Fragment key={`delete-${mod.uuid}`}>{renderDeleteRow(mod, nestedModIds.has(mod.uuid))}</React.Fragment>
                  }
                  const showInsertAfterRow = hasInsertAfterInstallRow && mod.uuid === installTargetModId
                  return (
                  <React.Fragment key={mod.uuid}>
                  <MemoModRow
                    key={mod.uuid}
                    mod={mod}
                    index={loadOrderMap.get(mod.uuid) ?? index + 1}
                    selected={selectedSet.has(mod.uuid)}
                    nested={nestedModIds.has(mod.uuid)}
                    animateOnEnter={mod.kind === 'mod' && separatorParentByModId.get(mod.uuid) === recentlyRevealedSeparatorId}
                    dragging={draggedModIds.includes(mod.uuid)}
                    dragEnabled={sortKey === null}
                    separatorDropTarget={mod.kind === 'separator' && dropSeparatorId === mod.uuid}
                    separatorCollapsed={mod.kind === 'separator' && collapsedSeparatorSet.has(mod.uuid)}
                    separatorChildCount={mod.kind === 'separator' ? (separatorSummary.total.get(mod.uuid) ?? 0) : 0}
                    separatorMoveHint={mod.kind === 'separator' && sortKey === null && draggedModCount > 0
                      ? `Drop ${draggedModCount} ${draggedModCount === 1 ? 'mod' : 'mods'} here`
                      : null}
                    rowDropPosition={rowDropTarget?.targetId === mod.uuid ? rowDropTarget.position : null}
                    onSelect={(event) => handleRowSelect(event, mod, index)}
                    onContextMenu={handleRowContextMenu}
                    onRename={handleStartRename}
                    onDelete={(targetMod) => setPendingDeleteMod(targetMod)}
                    onOpenDetails={(targetMod) => setDetailOverlay({ modId: targetMod.uuid })}
                    isRenaming={renamingModId === mod.uuid}
                    renameValue={renameValue}
                    onRenameChange={setRenameValue}
                    onRenameSave={handleSaveRename}
                    onRenameCancel={handleCancelRename}
                    onDragStart={handleRowDragStart}
                    onDragEnd={handleRowDragEnd}
                    onRowDragOver={handleModRowDragOver}
                    onRowDragLeave={handleModRowDragLeave}
                    onRowDrop={handleModRowDrop}
                    onSeparatorDragOver={handleSeparatorDragOver}
                    onSeparatorDragLeave={handleSeparatorDragLeave}
                    onSeparatorDrop={handleSeparatorDrop}
                  />
                  {showInsertAfterRow ? renderInstallRow(installTargetNested) : null}
                  </React.Fragment>
                  )
                })}
                {showAppendInstallRow ? renderInstallRow() : null}
              </div>
            )}
          </div>

          </div>
        </div>
      </div>

      {detailOverlay && (
        <DetailPanel
          modId={detailOverlay.modId}
          initialEditName={detailOverlay.initialEditName}
          onClose={() => setDetailOverlay(null)}
          onDeleteRequest={(mod) => {
            setDetailOverlay(null)
            setPendingDeleteMod(mod)
          }}
        />
      )}

      {separatorDialog && (
        <SeparatorNameDialog
          title={separatorDialog.mode === 'create' ? 'Create Separator' : 'Rename Separator'}
          description={separatorDialog.mode === 'create'
            ? 'Create a library divider for custom order. You can drag mods into it later or use Move to Separator from the selection bar.'
            : 'Update the label shown for this separator in Custom Order.'}
          value={separatorDialog.value}
          submitLabel={separatorDialog.mode === 'create' ? 'Create Separator' : 'Save Name'}
          onChange={(value) => setSeparatorDialog((current) => current ? { ...current, value } : current)}
          onSubmit={() => void handleSubmitSeparatorDialog()}
          onCancel={() => {
            if (separatorDialogSubmitting) return
            setSeparatorDialogSubmitting(false)
            setSeparatorDialog(null)
          }}
          selectOnOpen={separatorDialog.mode === 'rename'}
          submitting={separatorDialogSubmitting}
        />
      )}

      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-[100] bg-[#0a0a0a] border-[0.5px] border-[#222] shadow-[0_10px_30px_rgba(0,0,0,0.5)] py-1 min-w-[220px] brand-font"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => void handleRefreshLibrary()}
            className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            <span>Refresh Library</span>
          </button>
          <div className="my-1 border-t-[0.5px] border-[#222]" />
          {contextMenu.kind === 'list' ? (
            <>
              <button
                onClick={() => void handleContextCreateSeparator()}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">label</span>
                <span>Create Separator Here</span>
              </button>
              <button
                onClick={() => void handleContextCreateSeparatorAtEnd()}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#9d9d9d] hover:bg-[#111] hover:text-white transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">south</span>
                <span>Create Separator at End</span>
              </button>
              {(selectedModCount > 0 && sortKey === null || allSeparatorIds.length > 0) && (
                <div className="my-1 border-t-[0.5px] border-[#222]" />
              )}
              {selectedModCount > 0 && sortKey === null && (
                <button
                  onClick={() => void handleMoveSelectedToTopLevel()}
                  className="flex items-center w-full px-4 py-2 text-[11px] text-[#c6f4ff] hover:bg-[#08141a] hover:text-[#4fd8ff] transition-colors gap-3 tracking-wider font-semibold uppercase"
                >
                  <span className="material-symbols-outlined text-[16px]">vertical_align_top</span>
                  <span>Move Selected to Top Level</span>
                </button>
              )}
              {allSeparatorIds.length > 0 && (
                <button
                  onClick={() => void handleToggleAllSeparators()}
                  className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
                >
                  <span className="material-symbols-outlined text-[16px]">{hasCollapsedSeparators ? 'unfold_more' : 'unfold_less'}</span>
                  <span>{hasCollapsedSeparators ? 'Expand All Separators' : 'Collapse All Separators'}</span>
                </button>
              )}
            </>
          ) : contextMenu.mod.kind === 'separator' ? (
            <>
              <button
                onClick={() => void handleContextCreateSeparatorBeforeRow()}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">segment</span>
                <span>Create Separator Before</span>
              </button>
              {allSeparatorIds.length > 0 && (
                <button
                  onClick={() => void handleToggleAllSeparators()}
                  className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
                >
                  <span className="material-symbols-outlined text-[16px]">{hasCollapsedSeparators ? 'unfold_more' : 'unfold_less'}</span>
                  <span>{hasCollapsedSeparators ? 'Expand All Separators' : 'Collapse All Separators'}</span>
                </button>
              )}
              <div className="my-1 border-t-[0.5px] border-[#222]" />
              <button
                onClick={handleContextRename}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
                <span>Rename Separator</span>
              </button>
              {selectedModCount > 0 && sortKey === null && (
                <button
                  onClick={() => void handleContextMoveSelectedHere()}
                  className="flex items-center w-full px-4 py-2 text-[11px] text-[#c6f4ff] hover:bg-[#08141a] hover:text-[#4fd8ff] transition-colors gap-3 tracking-wider font-semibold uppercase"
                >
                  <span className="material-symbols-outlined text-[16px]">move_down</span>
                  <span>Move {selectedModCount} Selected Here</span>
                </button>
              )}
              <div className="my-1 border-t-[0.5px] border-[#222]" />
              <button
                onClick={handleContextOpenFolder}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span>Open in File Explorer</span>
              </button>
              <button
                onClick={handleContextDelete}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#ffb4ab] hover:bg-[#93000a]/10 transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Delete Separator</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => void handleContextCreateSeparatorBeforeRow()}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">segment</span>
                <span>Create Separator Before</span>
              </button>
              <button
                onClick={handleContextReinstall}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">settings_backup_restore</span>
                <span>Reinstall</span>
              </button>
              <div className="my-1 border-t-[0.5px] border-[#222]" />
              <button
                onClick={handleContextDetails}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">info</span>
                <span>Details</span>
              </button>
              <button
                onClick={handleContextRename}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
                <span>Rename</span>
              </button>
              {sortKey === null && (
                <button
                  onClick={() => void handleContextMoveToTopLevel()}
                  className="flex items-center w-full px-4 py-2 text-[11px] text-[#c6f4ff] hover:bg-[#08141a] hover:text-[#4fd8ff] transition-colors gap-3 tracking-wider font-semibold uppercase"
                >
                  <span className="material-symbols-outlined text-[16px]">vertical_align_top</span>
                  <span>{getContextTargetModIds().length > 1 ? 'Move Selected to Top Level' : 'Move to Top Level'}</span>
                </button>
              )}
              <div className="my-1 border-t-[0.5px] border-[#222]" />
              <button
                onClick={handleContextEnable}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">toggle_on</span>
                <span>Enable</span>
              </button>
              <button
                onClick={handleContextDisable}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#ff4d4f] transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">toggle_off</span>
                <span>Disable</span>
              </button>
              <div className="my-1 border-t-[0.5px] border-[#222]" />
              { (contextMenu.mod.nexusModId || contextMenu.mod.nexusFileId) && (
                <button
                  onClick={handleContextOpenOnNexus}
                  className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
                >
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                  <span>Open on Nexus</span>
                </button>
              )}
              <button
                onClick={handleContextOpenFolder}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span>Open in File Explorer</span>
              </button>
              <div className="my-1 border-t-[0.5px] border-[#222]" />
              <button
                onClick={handleContextDelete}
                className="flex items-center w-full px-4 py-2 text-[11px] text-[#ffb4ab] hover:bg-[#93000a]/10 transition-colors gap-3 tracking-wider font-semibold uppercase"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Delete</span>
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {pendingDeleteMod && (
        <ActionPromptDialog
          accentColor="#ff4d4f"
          accentGlow="rgba(255,77,79,0.45)"
          title={pendingDeleteMod.kind === 'separator' ? 'Delete Separator' : 'Delete Mod'}
          description={pendingDeleteMod.kind === 'separator'
            ? `You are about to permanently delete the separator ${pendingDeleteMod.name} from your mod library.`
            : `You are about to permanently delete ${pendingDeleteMod.name} from your mod library.`}
          detailLabel={pendingDeleteMod.kind === 'separator' ? 'Separator being deleted' : 'Mod being deleted'}
          detailValue={pendingDeleteMod.name}
          icon="delete"
          primaryLabel="Delete"
          onPrimary={() => {
            const target = pendingDeleteMod
            setPendingDeleteMod(null)
            if (target) {
              void handleDeleteMod(target)
            }
          }}
          onCancel={() => setPendingDeleteMod(null)}
          primaryTextColor="#ffffff"
        />
      )}

      {pendingAction?.type === 'delete-all' && (
        <ActionPromptDialog
          accentColor="#ff4d4f"
          accentGlow="rgba(255,77,79,0.4)"
          title="Delete Entire Library"
          description="This permanently deletes every visible library entry, including separators. Enabled mods are removed from the game first, then erased from the library itself."
          detailLabel={allSeparators.length > 0 ? 'Library entries' : 'Installed mods'}
          detailValue={String(pendingAction.count)}
          icon="delete_sweep"
          primaryLabel="Delete Everything"
          primaryTextColor="#ffffff"
          onPrimary={() => void handleDeleteAll()}
          onCancel={() => setPendingAction(null)}
          submitting={submittingAction}
        />
      )}
      {pendingAction?.type === 'delete-selected' && (
        <ActionPromptDialog
          accentColor="#ff4d4f"
          accentGlow="rgba(255,77,79,0.4)"
          title="Delete Selected Mods"
          description="This permanently deletes every selected mod from the current library. Enabled mods are removed from the game first, then erased from disk."
          detailLabel="Selected mods"
          detailValue={String(pendingAction.count)}
          detailContent={(
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#1d1d1d] pb-3">
                <div className="text-sm font-mono text-[#9a9a9a]">
                  Mods being uninstalled
                </div>
                <div className="rounded-sm border-[0.5px] border-[#4a1c1c] bg-[#160909] px-2.5 py-1 text-sm font-mono text-[#ffb4ab]">
                  {pendingAction.count} selected
                </div>
              </div>
              <div className="delete-dialog-scrollbar mt-3 max-h-[248px] space-y-2 overflow-y-auto pr-1">
                {selectedMods.map((mod) => (
                  <div
                    key={mod.uuid}
                    className="rounded-sm border-[0.5px] border-[#2c1515] bg-[#120909] px-3 py-2 text-[12px] text-[#ffe1e1] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
                  >
                    {mod.name}
                  </div>
                ))}
              </div>
            </div>
          )}
          icon="delete"
          primaryLabel="Delete Selected"
          primaryTextColor="#ffffff"
          onPrimary={() => void handleDeleteSelected(pendingAction.modIds)}
          onCancel={() => setPendingAction(null)}
          submitting={submittingAction}
        />
      )}
      {bulkSelectionActive && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center px-6">
          <div data-bulk-actions="true" className="pointer-events-auto flex items-stretch gap-4 rounded-sm border-[0.5px] border-[#2e2e2e] bg-[#080808] p-2 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
            <button
              onClick={() => void runBulkToggle(selectedModIds, 'enable')}
              className={`${darkBrowseLikeButtonClass} gap-1.5 px-4 text-[9px]`}
            >
              <span className="material-symbols-outlined text-[15px]">check_circle</span>
              Enable
            </button>
            <button
              onClick={() => void runBulkToggle(selectedModIds, 'disable')}
              className={`${darkBrowseLikeButtonClass} gap-1.5 px-4 text-[9px]`}
            >
              <span className="material-symbols-outlined text-[15px]">do_not_disturb_on</span>
              Disable
            </button>
            {sortKey === null && (
              <>
                <div ref={moveSeparatorMenuRef} className="relative">
                  <button
                    onClick={() => setMoveSeparatorMenuOpen((current) => !current)}
                    className={`${darkBrowseLikeButtonClass} gap-1.5 px-4 text-[9px]`}
                  >
                    <span className="material-symbols-outlined text-[15px]">move_item</span>
                    Move to Separator
                    <span className="material-symbols-outlined text-[15px]">{moveSeparatorMenuOpen ? 'expand_less' : 'expand_more'}</span>
                  </button>
                  {moveSeparatorMenuOpen && (
                    <div className="absolute bottom-[calc(100%+8px)] left-0 min-w-[260px] overflow-hidden rounded-sm border-[0.5px] border-[#2a2a2a] bg-[#0a0a0a] shadow-[0_16px_32px_rgba(0,0,0,0.55)]">
                      <div className="border-b-[0.5px] border-[#1a1a1a] px-4 py-2 text-[11px] brand-font font-bold uppercase tracking-[0.16em] text-[#7f7f7f]">
                        Move {selectedModCount} Selected Mods
                      </div>
                      <div className="max-h-[240px] overflow-y-auto py-1">
                        {allSeparators.length > 0 ? allSeparators.map((separator) => (
                          <button
                            key={separator.uuid}
                            onClick={() => void handleMoveSelectedToSeparator(separator.uuid)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[11px] brand-font font-bold uppercase tracking-[0.14em] text-[#d8d8d8] transition-colors hover:bg-[#101010] hover:text-[#fcee09]"
                          >
                            <span className="truncate">{separator.name}</span>
                            <span className="material-symbols-outlined text-[15px] text-[#6d6d6d]">subdirectory_arrow_right</span>
                          </button>
                        )) : (
                          <div className="px-4 py-3 text-sm text-[#8a8a8a]">
                            No separators available yet.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void moveModsToTopLevel(selectedModIds)}
                  className={`${darkBrowseLikeButtonClass} gap-1.5 px-4 text-[9px]`}
                >
                  <span className="material-symbols-outlined text-[15px]">vertical_align_top</span>
                  Top Level
                </button>
              </>
            )}
            <button
              onClick={() => setPendingAction({ type: 'delete-selected', count: selectedModCount, modIds: [...selectedModIds] })}
              className={`${destructiveButtonClass} gap-1.5 px-4 text-[9px]`}
            >
              <span className="material-symbols-outlined text-[15px]">delete</span>
              Uninstall
            </button>
            <div className="mx-1.5 h-5 self-center w-px bg-[#2a2a2a] shadow-[0_0_6px_rgba(255,255,255,0.06)]" />
            <button
              onClick={() => {
                setSelectedIds([])
                setSelectionAnchorId(null)
                selectMod(null)
              }}
              className="flex h-10 w-10 items-center justify-center rounded-sm border-[0.5px] border-[#242424] bg-[#0b0b0b] text-[#8a8a8a] transition-colors hover:border-[#5d5d5d] hover:text-white"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
