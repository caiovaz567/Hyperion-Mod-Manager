import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IPC, type IpcResult, type ModMetadata } from '@shared/types'
import { IpcService } from '../../services/IpcService'
import { DetailPanel } from './DetailPanel'
import { LibraryBulkSelectionBar } from './LibraryBulkSelectionBar'
import { LibraryConflictFloatingRows } from './LibraryConflictFloatingRows'
import { LibraryContextMenu } from './LibraryContextMenu'
import { LibraryDeleteDialogs } from './LibraryDeleteDialogs'
import type { LibraryPendingActionState } from './LibraryDeleteDialogs'
import { LibraryRows } from './LibraryRows'
import { LibraryTableHeader } from './LibraryTableHeader'
import { LibraryDeleteProgressRow, LibraryInstallProgressRow } from './LibraryProgressRows'
import { LibraryToolbar } from './LibraryToolbar'
import { SeparatorNameDialog } from '../ui/SeparatorNameDialog'
import { MoveToSeparatorDialog } from '../ui/MoveToSeparatorDialog'
import { HyperionPanel } from '../ui/HyperionPrimitives'
import { useTranslation } from '../../i18n/I18nContext'
import { useLibraryBulkToggle } from './useLibraryBulkToggle'
import { useLibraryContextMenuActions } from './useLibraryContextMenuActions'
import { useLibraryContextMenuState } from './useLibraryContextMenuState'
import { useLibraryConflictHighlight } from './useLibraryConflictHighlight'
import { useLibraryDragDrop } from './useLibraryDragDrop'
import { useLibraryDeleteActions } from './useLibraryDeleteActions'
import { useLibraryEntries } from './useLibraryEntries'
import { useLibraryInstallActions } from './useLibraryInstallActions'
import { useLibraryRenameActions } from './useLibraryRenameActions'
import { useLibraryRowSelection } from './useLibraryRowSelection'
import { useLibrarySeparatorActions } from './useLibrarySeparatorActions'
import { useLibrarySelection } from './useLibrarySelection'
import { useLibrarySort } from './useLibrarySort'
import { Icon } from '../ui/Icon'

interface DetailOverlayState {
  modId: string
  initialTab?: 'files' | 'conflicts'
  initialEditName?: boolean
}

const MOD_ROW_HEIGHT = 48
// Above this many rows the list windows (renders only the visible slice + overscan),
// so the first paint and every scroll frame touch ~30-50 rows instead of all of them.
// The scroll-position state that drives windowing now lives INSIDE <LibraryRows>, so a
// scroll re-renders only that small row list - never this large ModList. That isolation
// is what makes a low threshold safe: the old warning ("re-renders the whole ModList on
// every scroll frame") no longer applies. Kept modest so a normal large library (100+
// mods) windows and starts up fast, while tiny libraries still render every row.
const MOD_VIRTUALIZATION_THRESHOLD = 60

export const ModList: React.FC = () => {
  const { t } = useTranslation()
  const [pendingDeleteMod, setPendingDeleteMod] = useState<ModMetadata | null>(null)
  const [pendingAction, setPendingAction] = useState<LibraryPendingActionState | null>(null)
  const [detailOverlay, setDetailOverlay] = useState<DetailOverlayState | null>(null)
  const [pendingConflictGoToModId, setPendingConflictGoToModId] = useState<string | null>(null)
  const [navigationHighlightModId, setNavigationHighlightModId] = useState<string | null>(null)
  const [moveSeparatorTargets, setMoveSeparatorTargets] = useState<string[] | null>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const listRowsRef = useRef<HTMLDivElement>(null)

  const {
    filter,
    setFilter,
    setTypeFilter,
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
    updateSettings,
    updateModMetadata,
    gamePathValid,
    libraryPathValid,
    gameRunning,
    typeFilter,
    installing,
    installSourcePath,
    installTargetModId,
    installPlacement,
    installProgress,
    installStatus,
    installCurrentFile,
    conflicts,
    conflictHighlight,
    setConflictHighlight,
    clearConflictHighlight,
    checkModUpdates,
    checkingModUpdates,
    modUpdates,
    collapsedSeparatorIds,
    setCollapsedSeparatorIds,
  } = useAppStore((state) => ({
    filter: state.filter,
    setFilter: state.setFilter,
    setTypeFilter: state.setTypeFilter,
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
    updateSettings: state.updateSettings,
    updateModMetadata: state.updateModMetadata,
    gamePathValid: state.gamePathValid,
    libraryPathValid: state.libraryPathValid,
    gameRunning: state.gameRunning,
    typeFilter: state.typeFilter,
    installing: state.installing,
    installSourcePath: state.installSourcePath,
    installTargetModId: state.installTargetModId,
    installPlacement: state.installPlacement,
    installProgress: state.installProgress,
    installStatus: state.installStatus,
    installCurrentFile: state.installCurrentFile,
    conflicts: state.conflicts,
    conflictHighlight: state.conflictHighlight,
    setConflictHighlight: state.setConflictHighlight,
    clearConflictHighlight: state.clearConflictHighlight,
    checkModUpdates: state.checkModUpdates,
    checkingModUpdates: state.checkingModUpdates,
    modUpdates: state.modUpdates,
    collapsedSeparatorIds: state.collapsedLibrarySeparatorIds,
    setCollapsedSeparatorIds: state.setCollapsedLibrarySeparatorIds,
  }), shallow)

  const updateCount = Object.values(modUpdates).filter((status) => status.state === 'update-available').length
  const collapsedSepsHydratedRef = useRef(false)

  // Hydrate collapsed separator state from persisted settings on first load.
  useEffect(() => {
    if (!settings || collapsedSepsHydratedRef.current) return
    const stored = settings.collapsedLibrarySeparatorIds
    if (Array.isArray(stored) && stored.length > 0) {
      setCollapsedSeparatorIds(stored)
    }
    collapsedSepsHydratedRef.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  // Persist collapsed separator state back to settings when it changes (after hydration).
  useEffect(() => {
    if (!settings || !collapsedSepsHydratedRef.current) return
    const stored = settings.collapsedLibrarySeparatorIds ?? []
    if (
      stored.length === collapsedSeparatorIds.length &&
      collapsedSeparatorIds.every((id) => stored.includes(id))
    ) return
    const timer = window.setTimeout(() => {
      void updateSettings({ collapsedLibrarySeparatorIds: collapsedSeparatorIds })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [collapsedSeparatorIds, settings, updateSettings])

  const {
    handleInstallFile,
    handleInstallClick,
  } = useLibraryInstallActions({
    settings,
    gamePathValid,
    libraryPathValid,
    gameRunning,
    installMod,
    enableMod,
    scanMods,
    addToast,
    setActiveView,
  })

  const {
    sortKey,
    sortDirection,
    handleSort,
    resetToCustomOrder,
  } = useLibrarySort()

  const {
    orderedEntries,
    allMods,
    allSeparators,
    allSeparatorIds,
    enabledCount,
    totalCount,
    enabledVisibleCount,
    disabledVisibleCount,
    collapsedSeparatorSet,
    separatorSummary,
    displayedMods,
    nestedModIds,
    separatorParentByModId,
    orderedEntryIds,
    getSeparatorBlockIds,
    expandSelectionWithSeparatorBlocks,
    loadOrderMap,
    visibleModIds,
    allVisibleEnabled,
  } = useLibraryEntries({
    mods,
    filter,
    typeFilter,
    libraryStatusFilter,
    collapsedSeparatorIds,
    sortKey,
    sortDirection,
  })

  const separatorUpdateCounts = useMemo(() => {
    const counts = new Map<string, number>()
    let currentSeparatorId: string | null = null
    for (const entry of orderedEntries) {
      if (entry.kind === 'separator') {
        currentSeparatorId = entry.uuid
        continue
      }
      if (!currentSeparatorId) continue
      if (modUpdates[entry.uuid]?.state === 'update-available') {
        counts.set(currentSeparatorId, (counts.get(currentSeparatorId) ?? 0) + 1)
      }
    }
    return counts
  }, [orderedEntries, modUpdates])

  const {
    isBulkToggling,
    runBulkToggle,
    runManagedBulkToggle,
  } = useLibraryBulkToggle({
    allMods,
    addToast,
  })

  const {
    selectedIds,
    setSelectedIds,
    setSelectionAnchorId,
    setSelection,
    resetSelection,
    clearSelection,
    selectedIdsRef,
    selectionAnchorIdRef,
    displayedModsRef,
    selectedSet,
    selectedMods,
    selectedModIds,
    selectedModCount,
    bulkSelectionActive,
  } = useLibrarySelection({
    displayedMods,
    orderedEntries,
    orderedEntryIds,
    selectMod,
  })

  const {
    contextMenu,
    contextMenuRef,
    closeContextMenu,
    handleRowContextMenu,
    handleListContextMenu,
  } = useLibraryContextMenuState({
    displayedModsLength: displayedMods.length,
    listRowsRef,
    rowHeight: MOD_ROW_HEIGHT,
    selectMod,
  })

  const {
    renamingModId,
    renameValue,
    setRenameValue,
    beginRename,
    handleSaveRename,
    handleCancelRename,
  } = useLibraryRenameActions({
    orderedEntries,
    updateModMetadata,
    addToast,
  })

  useLibraryConflictHighlight({
    selectedIds,
    mods,
    conflicts,
    setConflictHighlight,
    clearConflictHighlight,
  })

  const clearPendingAction = useCallback(() => setPendingAction(null), [])
  const {
    deletingRows,
    deleteProgressTick,
    submittingAction,
    handleDeleteAll,
    handleDeleteSelected,
    handleDeleteMod,
  } = useLibraryDeleteActions({
    orderedEntries,
    allMods,
    deleteMod,
    addToast,
    resetSelection,
    clearPendingAction,
  })

  const {
    recentlyRevealedSeparatorId,
    separatorDialog,
    separatorDialogSubmitting,
    revealSeparator,
    moveModsToSeparator,
    moveModsToTopLevel,
    handleMoveSelectedToTopLevel,
    handleCreateSeparator,
    handleSubmitSeparatorDialog,
    handleExpandAllSeparators,
    handleCollapseAllSeparators,
    handleSeparatorDialogValueChange,
    handleCancelSeparatorDialog,
  } = useLibrarySeparatorActions({
    collapsedSeparatorIds,
    setCollapsedSeparatorIds,
    allMods,
    allSeparators,
    allSeparatorIds,
    orderedEntries,
    displayedMods,
    selectedModIds,
    selectedModCount,
    sortKey,
    resetToCustomOrder,
    addToast,
    createSeparator,
    scanMods,
    selectMod,
    updateModMetadata,
    resetSelection,
    closeContextMenu,
  })

  const {
    handleRowSelect,
  } = useLibraryRowSelection({
    collapsedSeparatorSet,
    displayedModsRef,
    selectedIdsRef,
    selectionAnchorIdRef,
    revealSeparator,
    selectMod,
    setCollapsedSeparatorIds,
    setSelectedIds,
    setSelectionAnchorId,
    setSelection,
  })

  const conflictSeparatorTones = useMemo(() => {
    const tones = new Map<string, 'win' | 'loss' | 'mixed'>()
    if (!conflictHighlight.active) return tones
    for (const modId of conflictHighlight.wins) {
      const parentId = separatorParentByModId.get(modId)
      if (!parentId) continue
      tones.set(parentId, tones.get(parentId) === 'loss' ? 'mixed' : 'win')
    }
    for (const modId of conflictHighlight.losses) {
      const parentId = separatorParentByModId.get(modId)
      if (!parentId) continue
      tones.set(parentId, tones.get(parentId) === 'win' ? 'mixed' : 'loss')
    }
    return tones
  }, [conflictHighlight, separatorParentByModId])

  const showCustomOrderBadge = sortKey === null
  const bulkToggleDisabled = libraryStatusFilter !== 'all'
  const bulkToggleTooltip = libraryStatusFilter === 'enabled'
    ? t('library.header.bulkUnavailableEnabled')
    : t('library.header.bulkUnavailableDisabled')
  const installTargetMod = installTargetModId
    ? allMods.find((mod) => mod.uuid === installTargetModId) ?? null
    : null
  const installTargetNested = installTargetMod ? nestedModIds.has(installTargetMod.uuid) : false
  const hasAppendInstallRow = installing && installPlacement === 'append'
  const hasInsertAfterInstallRow = installing && installPlacement === 'insert-after'

  // Windowing now lives inside <LibraryRows> (it owns the scroll-position state), so
  // scrolling re-renders only that row list - never this large ModList. That's the
  // isolation the threshold note below depends on.
  const virtualizationEnabled = displayedMods.length > MOD_VIRTUALIZATION_THRESHOLD
  const selectedConflictMod = selectedIds.length === 1
    ? allMods.find((mod) => mod.uuid === selectedIds[0]) ?? null
    : null

  const scrollToDisplayedMod = useCallback((modId: string) => {
    const scrollElement = listScrollRef.current
    if (!scrollElement) return false

    const targetIndex = displayedMods.findIndex((entry) => entry.uuid === modId)
    if (targetIndex < 0) return false

    const row = Array.from(scrollElement.querySelectorAll<HTMLElement>('[data-mod-id]'))
      .find((element) => element.dataset.modId === modId)

    let targetScrollTop: number
    if (row) {
      const containerRect = scrollElement.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      targetScrollTop = scrollElement.scrollTop + rowRect.top - containerRect.top - (scrollElement.clientHeight - rowRect.height) / 2
    } else {
      targetScrollTop = targetIndex * MOD_ROW_HEIGHT - scrollElement.clientHeight * 0.42
    }
    targetScrollTop = Math.max(0, Math.min(targetScrollTop, scrollElement.scrollHeight - scrollElement.clientHeight))

    const startTop = scrollElement.scrollTop
    const distance = targetScrollTop - startTop
    const duration = 200
    const startTime = performance.now()
    const step = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1)
      const eased = 1 - (1 - t) * (1 - t) * (1 - t)
      scrollElement.scrollTop = startTop + distance * eased
      if (t < 1) window.requestAnimationFrame(step)
    }
    window.requestAnimationFrame(step)

    return true
  }, [displayedMods])

  useEffect(() => {
    if (!pendingConflictGoToModId) return

    let attempts = 0
    let frame = 0
    const targetModId = pendingConflictGoToModId

    const attemptScroll = () => {
      if (scrollToDisplayedMod(targetModId)) {
        setSelection([targetModId], targetModId)
        selectMod(targetModId)
        setNavigationHighlightModId(targetModId)
        window.setTimeout(() => {
          setNavigationHighlightModId((current) => (current === targetModId ? null : current))
        }, 1600)
        setPendingConflictGoToModId(null)
        return
      }

      attempts += 1
      if (attempts < 6) {
        frame = window.requestAnimationFrame(attemptScroll)
        return
      }

      setPendingConflictGoToModId(null)
      addToast(t('library.toast.revealFailed'), 'warning', 2600)
    }

    frame = window.requestAnimationFrame(attemptScroll)
    return () => window.cancelAnimationFrame(frame)
  }, [addToast, pendingConflictGoToModId, scrollToDisplayedMod, selectMod, setSelection])

  const handleOpenModsFolder = useCallback(async () => {
    const libraryPath = settings?.libraryPath?.trim()
    if (!libraryPath) {
      addToast(t('library.toast.modsFolderNotConfigured'), 'warning')
      return
    }

    const result = await IpcService.invoke<IpcResult>(IPC.OPEN_PATH, libraryPath)
    if (!result.ok) {
      addToast(result.error ?? t('library.toast.openModsFolderFailed'), 'error')
    }
  }, [addToast, settings?.libraryPath])

  const handleGoToConflictMod = useCallback((modId: string) => {
    const targetMod = allMods.find((mod) => mod.uuid === modId)

    if (filter) setFilter('')
    if (typeFilter) setTypeFilter('')
    if (
      targetMod &&
      ((libraryStatusFilter === 'enabled' && !targetMod.enabled) ||
        (libraryStatusFilter === 'disabled' && targetMod.enabled))
    ) {
      setLibraryStatusFilter('all')
    }

    const parentId = separatorParentByModId.get(modId)
    if (parentId && collapsedSeparatorSet.has(parentId)) {
      revealSeparator(parentId)
    }

    setPendingConflictGoToModId(modId)
  }, [
    allMods,
    collapsedSeparatorSet,
    filter,
    libraryStatusFilter,
    revealSeparator,
    separatorParentByModId,
    setFilter,
    setLibraryStatusFilter,
    setTypeFilter,
    typeFilter,
  ])

  useEffect(() => {
    if (!libraryDeleteAllRequestedAt) return
    setPendingAction({ type: 'delete-all', count: orderedEntries.length })
    clearLibraryDeleteAllRequest()
  }, [clearLibraryDeleteAllRequest, libraryDeleteAllRequestedAt, orderedEntries.length])

  const requestDelete = useCallback((mod: ModMetadata) => setPendingDeleteMod(mod), [])
  const openDetails = useCallback((modId: string) => {
    setDetailOverlay({ modId })
  }, [])

  const {
    isDragging,
    draggedModIds,
    draggedModCount,
    rowDropTarget,
    dropSeparatorId,
    topLevelDropActive,
    handleRowDragStart,
    handleRowDragEnd,
    handleModRowDragOver,
    handleModRowDragLeave,
    handleModRowDrop,
    handleSeparatorDragOver,
    handleSeparatorDragLeave,
    handleSeparatorDrop,
    handleTopLevelDragOver,
    handleTopLevelDragLeave,
    handleTopLevelDrop,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleListRowsDragOver,
    handleListRowsDragLeave,
    handleListRowsDrop,
  } = useLibraryDragDrop({
    orderedEntries,
    displayedMods,
    sortKey,
    scrollContainerRef: listScrollRef,
    selectedIdsRef,
    expandSelectionWithSeparatorBlocks,
    getSeparatorBlockIds,
    setSelection,
    selectMod,
    addToast,
    moveModsToSeparator,
    moveModsToTopLevel,
    installDroppedFile: handleInstallFile,
  })
  const showTopLevelHeaderDrop = sortKey === null && allSeparators.length > 0 && draggedModIds.length > 0

  const {
    getContextTargetModIds,
    handleContextOpenFolder,
    handleContextOpenOnNexus,
    handleContextDelete,
    handleContextRename,
    handleContextDetails,
    handleContextReinstall,
    handleContextMoveToTopLevel,
    handleContextCheckUpdate,
  } = useLibraryContextMenuActions({
    contextMenu,
    selectedModIds,
    settings,
    addToast,
    openReinstallPrompt,
    moveModsToTopLevel,
    closeContextMenu,
    requestDelete,
    beginRename,
    openDetails,
    checkModUpdate: (modId) => void checkModUpdates({ force: true, notify: true, modIds: [modId] }),
  })

  const handleContextOpenMoveToSeparator = useCallback(() => {
    const targetIds = getContextTargetModIds()
    if (targetIds.length === 0) return
    setMoveSeparatorTargets(targetIds)
    closeContextMenu()
  }, [closeContextMenu, getContextTargetModIds])

  const handleBulkOpenMoveToSeparator = useCallback(() => {
    if (selectedModIds.length === 0) return
    setMoveSeparatorTargets([...selectedModIds])
  }, [selectedModIds])

  const handleMoveTargetsToSeparator = useCallback(async (separatorId: string) => {
    if (!moveSeparatorTargets) return
    const scrollElement = listScrollRef.current
    const previousScrollTop = scrollElement?.scrollTop ?? null
    setMoveSeparatorTargets(null)

    const movePromise = moveModsToSeparator(moveSeparatorTargets, separatorId, { reveal: false })

    if (scrollElement && previousScrollTop !== null) {
      scrollElement.scrollTop = previousScrollTop
      window.requestAnimationFrame(() => {
        scrollElement.scrollTop = previousScrollTop
        window.requestAnimationFrame(() => {
          scrollElement.scrollTop = previousScrollTop
        })
      })
    }

    await movePromise
  }, [moveModsToSeparator, moveSeparatorTargets])

  const handleContextCreateSeparator = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'list') return
    handleCreateSeparator(contextMenu.insertIndex)
    closeContextMenu()
  }, [closeContextMenu, contextMenu, handleCreateSeparator])

  const handleContextCreateSeparatorBeforeRow = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'row') return

    const rowIndex = displayedMods.findIndex((entry) => entry.uuid === contextMenu.mod.uuid)
    handleCreateSeparator(rowIndex >= 0 ? rowIndex : undefined, contextMenu.mod.uuid)
    closeContextMenu()
  }, [closeContextMenu, contextMenu, displayedMods, handleCreateSeparator])

  const handleRefreshLibrary = useCallback(async () => {
    closeContextMenu()
    await scanMods()
    addToast(t('library.toast.refreshed'), 'success', 1200)
  }, [addToast, closeContextMenu, scanMods])

  const handleFilterChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(event.target.value)
  }

  const renderInstallRow = (nestedRow = false) => (
    <LibraryInstallProgressRow
      nested={nestedRow}
      targetName={installTargetMod?.name}
      sourcePath={installSourcePath}
      progress={installProgress}
      status={installStatus}
      currentFile={installCurrentFile}
    />
  )

  const renderDeleteRow = (mod: ModMetadata, nestedRow = false) => (
    <LibraryDeleteProgressRow
      mod={mod}
      nested={nestedRow}
      loadOrder={loadOrderMap.get(mod.uuid)}
      startedAt={deletingRows[mod.uuid]?.startedAt}
      tick={deleteProgressTick}
    />
  )

  return (
    <div className="h-full animate-settings-in">
    <div
      className="flex flex-col h-full overflow-hidden relative select-none"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[var(--bg-base-deep)]/90 border-[1px] border-[var(--accent)]/40 pointer-events-none">
          <Icon name="file_download" className="text-[48px] text-[var(--accent)] mb-4" />
          <span className="brand-font text-[15px] text-[var(--accent)] tracking-widest uppercase">{t('library.dnd.dropToInstall')}</span>
        </div>
      )}

      <LibraryToolbar
        totalCount={totalCount}
        enabledCount={enabledCount}
        filter={filter}
        statusFilter={libraryStatusFilter}
        showCustomOrderBadge={showCustomOrderBadge}
        onFilterChange={handleFilterChange}
        onClearFilter={() => setFilter('')}
        onStatusFilterChange={setLibraryStatusFilter}
        onOpenModsFolder={() => void handleOpenModsFolder()}
        onDeleteAll={() => requestLibraryDeleteAll()}
        onInstallMod={handleInstallClick}
        onCheckUpdates={() => void checkModUpdates({ force: true, notify: true })}
        checkingUpdates={checkingModUpdates}
        updateCount={updateCount}
      />

        {/* Table - has its own scroll, toolbar stays fixed above */}
      <div className="flex-1 overflow-hidden px-8 pb-6 w-full">
        <HyperionPanel className="relative h-full overflow-hidden">
          <div
            ref={listScrollRef}
            className="hyperion-scrollbar managed-mods-scroll h-full overflow-auto"
            style={{ overflowAnchor: 'none' } as React.CSSProperties}
          >

          <LibraryTableHeader
            sortKey={sortKey}
            sortDirection={sortDirection}
            showCustomOrderBadge={showCustomOrderBadge}
            showTopLevelHeaderDrop={showTopLevelHeaderDrop}
            topLevelDropActive={topLevelDropActive}
            bulkToggleDisabled={bulkToggleDisabled}
            bulkToggleTooltip={bulkToggleTooltip}
            isBulkToggling={isBulkToggling}
            allVisibleEnabled={allVisibleEnabled}
            onSort={handleSort}
            onTopLevelDragOver={handleTopLevelDragOver}
            onTopLevelDragLeave={handleTopLevelDragLeave}
            onTopLevelDrop={handleTopLevelDrop}
            onBulkToggle={() => {
              void runManagedBulkToggle(visibleModIds, allVisibleEnabled ? 'disable' : 'enable')
            }}
          />

          <LibraryRows
            rowsRef={listRowsRef}
            displayedMods={displayedMods}
            scrollContainerRef={listScrollRef}
            rowHeight={MOD_ROW_HEIGHT}
            virtualizationEnabled={virtualizationEnabled}
            filter={filter}
            totalCount={totalCount}
            libraryStatusFilter={libraryStatusFilter}
            disabledVisibleCount={disabledVisibleCount}
            enabledVisibleCount={enabledVisibleCount}
            deletingRows={deletingRows}
            installing={installing}
            installPlacement={installPlacement}
            installTargetModId={installTargetModId}
            installTargetNested={installTargetNested}
            hasInsertAfterInstallRow={hasInsertAfterInstallRow}
            hasAppendInstallRow={hasAppendInstallRow}
            loadOrderMap={loadOrderMap}
            selectedSet={selectedSet}
            nestedModIds={nestedModIds}
            separatorParentByModId={separatorParentByModId}
            recentlyRevealedSeparatorId={recentlyRevealedSeparatorId}
            navigationHighlightModId={navigationHighlightModId}
            conflictSeparatorTones={conflictSeparatorTones}
            draggedModIds={draggedModIds}
            sortKey={sortKey}
            dropSeparatorId={dropSeparatorId}
            collapsedSeparatorSet={collapsedSeparatorSet}
            separatorSummaryTotal={separatorSummary.total}
            separatorUpdateCounts={separatorUpdateCounts}
            draggedModCount={draggedModCount}
            rowDropTarget={rowDropTarget}
            renamingModId={renamingModId}
            renameValue={renameValue}
            onContextMenu={handleListContextMenu}
            onDragOver={handleListRowsDragOver}
            onDragLeave={handleListRowsDragLeave}
            onDrop={handleListRowsDrop}
            onOpenDownloads={() => setActiveView('downloads')}
            onRowSelect={handleRowSelect}
            onRowContextMenu={handleRowContextMenu}
            onRename={beginRename}
            onDelete={requestDelete}
            onOpenDetails={(targetMod, initialTab) => setDetailOverlay({ modId: targetMod.uuid, initialTab })}
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
            renderInstallRow={renderInstallRow}
            renderDeleteRow={renderDeleteRow}
          />

          </div>
          <LibraryConflictFloatingRows
            selectedMod={selectedConflictMod}
            conflicts={conflicts}
            allMods={allMods}
            allSeparators={allSeparators}
            displayedMods={displayedMods}
            scrollContainerRef={listScrollRef}
            rowHeight={MOD_ROW_HEIGHT}
            loadOrderMap={loadOrderMap}
            separatorParentByModId={separatorParentByModId}
            collapsedSeparatorSet={collapsedSeparatorSet}
            onGoToMod={handleGoToConflictMod}
          />
        </HyperionPanel>
      </div>

      {detailOverlay && (
        <DetailPanel
          modId={detailOverlay.modId}
          initialTab={detailOverlay.initialTab}
          initialEditName={detailOverlay.initialEditName}
          onClose={() => setDetailOverlay(null)}
        />
      )}

      {separatorDialog && (
        <SeparatorNameDialog
          title={separatorDialog.mode === 'create' ? t('library.separatorDialog.createTitle') : t('library.separatorDialog.renameTitle')}
          description={separatorDialog.mode === 'create'
            ? t('library.separatorDialog.createDescription')
            : t('library.separatorDialog.renameDescription')}
          value={separatorDialog.value}
          submitLabel={separatorDialog.mode === 'create' ? t('library.separatorDialog.createSubmit') : t('library.separatorDialog.renameSubmit')}
          onChange={handleSeparatorDialogValueChange}
          onSubmit={() => void handleSubmitSeparatorDialog()}
          onCancel={handleCancelSeparatorDialog}
          selectOnOpen={separatorDialog.mode === 'rename'}
          submitting={separatorDialogSubmitting}
        />
      )}

      {moveSeparatorTargets && (
        <MoveToSeparatorDialog
          separators={allSeparators}
          modCount={moveSeparatorTargets.length}
          onSelect={(separatorId) => void handleMoveTargetsToSeparator(separatorId)}
          onCancel={() => setMoveSeparatorTargets(null)}
        />
      )}

      {contextMenu && (
        <LibraryContextMenu
          menu={contextMenu}
          menuRef={contextMenuRef}
          selectedModCount={selectedModCount}
          separators={allSeparators}
          hasSeparators={allSeparatorIds.length > 0}
          canMoveSelectedToTopLevel={sortKey === null}
          canMoveContextToTopLevel={sortKey === null}
          contextTargetCount={getContextTargetModIds().length}
          onRefreshLibrary={handleRefreshLibrary}
          onCreateSeparatorHere={handleContextCreateSeparator}
          onMoveSelectedToTopLevel={handleMoveSelectedToTopLevel}
          onExpandAllSeparators={handleExpandAllSeparators}
          onCollapseAllSeparators={handleCollapseAllSeparators}
          onOpenMoveToSeparator={handleContextOpenMoveToSeparator}
          onCreateSeparatorBeforeRow={handleContextCreateSeparatorBeforeRow}
          onRename={handleContextRename}
          onOpenFolder={handleContextOpenFolder}
          onDelete={handleContextDelete}
          onReinstall={handleContextReinstall}
          onDetails={handleContextDetails}
          onMoveContextToTopLevel={handleContextMoveToTopLevel}
          onOpenOnNexus={handleContextOpenOnNexus}
          onCheckUpdate={handleContextCheckUpdate}
        />
      )}

      <LibraryDeleteDialogs
        pendingDeleteMod={pendingDeleteMod}
        pendingAction={pendingAction}
        selectedMods={selectedMods}
        submitting={submittingAction}
        hasSeparators={allSeparators.length > 0}
        onConfirmDeleteMod={(target) => {
          setPendingDeleteMod(null)
          void handleDeleteMod(target)
        }}
        onCancelDeleteMod={() => setPendingDeleteMod(null)}
        onConfirmDeleteAll={handleDeleteAll}
        onConfirmDeleteSelected={handleDeleteSelected}
        onCancelAction={() => setPendingAction(null)}
      />

      {bulkSelectionActive && (
        <LibraryBulkSelectionBar
          canMove={sortKey === null}
          hasSeparators={allSeparators.length > 0}
          onOpenMoveMenu={handleBulkOpenMoveToSeparator}
          onEnableSelected={() => runBulkToggle(selectedModIds, 'enable')}
          onDisableSelected={() => runBulkToggle(selectedModIds, 'disable')}
          onMoveToTopLevel={() => moveModsToTopLevel(selectedModIds)}
          onDeleteSelected={() => setPendingAction({ type: 'delete-selected', count: selectedModCount, modIds: [...selectedModIds] })}
          onClearSelection={clearSelection}
        />
      )}
    </div>
    </div>
  )
}
