import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import type { ModMetadata } from '@shared/types'
import { DetailPanel } from './DetailPanel'
import { LibraryBulkSelectionBar } from './LibraryBulkSelectionBar'
import { LibraryContextMenu } from './LibraryContextMenu'
import { LibraryDeleteDialogs } from './LibraryDeleteDialogs'
import type { LibraryPendingActionState } from './LibraryDeleteDialogs'
import { LibraryRows } from './LibraryRows'
import { LibraryTableHeader } from './LibraryTableHeader'
import { LibraryDeleteProgressRow, LibraryInstallProgressRow } from './LibraryProgressRows'
import { LibraryToolbar } from './LibraryToolbar'
import { SeparatorNameDialog } from '../ui/SeparatorNameDialog'
import { HyperionPanel } from '../ui/HyperionPrimitives'
import { useVirtualRows } from '../../hooks/useVirtualRows'
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

interface DetailOverlayState {
  modId: string
  initialTab?: 'files' | 'conflicts'
  initialEditName?: boolean
}

const MOD_ROW_HEIGHT = 38
const MOD_VIRTUALIZATION_THRESHOLD = 120

export const ModList: React.FC = () => {
  const [pendingDeleteMod, setPendingDeleteMod] = useState<ModMetadata | null>(null)
  const [pendingAction, setPendingAction] = useState<LibraryPendingActionState | null>(null)
  const [detailOverlay, setDetailOverlay] = useState<DetailOverlayState | null>(null)
  const [collapsedSeparatorIds, setCollapsedSeparatorIds] = useState<string[]>([])
  const listScrollRef = useRef<HTMLDivElement>(null)
  const listRowsRef = useRef<HTMLDivElement>(null)

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
    conflicts,
    setConflictHighlight,
    clearConflictHighlight,
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
    conflicts: state.conflicts,
    setConflictHighlight: state.setConflictHighlight,
    clearConflictHighlight: state.clearConflictHighlight,
  }), shallow)

  const {
    handleInstallFile,
    handleInstallClick,
  } = useLibraryInstallActions({
    settings,
    gamePathValid,
    libraryPathValid,
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
    hasCollapsedSeparators,
    recentlyRevealedSeparatorId,
    separatorDialog,
    separatorDialogSubmitting,
    moveSeparatorMenuOpen,
    moveSeparatorMenuRef,
    revealSeparator,
    moveModsToSeparator,
    moveModsToTopLevel,
    handleMoveSelectedToSeparator,
    handleMoveSelectedToTopLevel,
    handleCreateSeparator,
    handleSubmitSeparatorDialog,
    handleToggleAllSeparators,
    handleSeparatorDialogValueChange,
    handleCancelSeparatorDialog,
    toggleMoveSeparatorMenu,
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

  const showCustomOrderBadge = sortKey === null && allSeparators.length > 0
  const bulkToggleDisabled = libraryStatusFilter !== 'all'
  const bulkToggleTooltip = libraryStatusFilter === 'enabled'
    ? 'Unavailable while Enabled filter is active'
    : 'Unavailable while Disabled filter is active'
  const installTargetMod = installTargetModId
    ? allMods.find((mod) => mod.uuid === installTargetModId) ?? null
    : null
  const installTargetNested = installTargetMod ? nestedModIds.has(installTargetMod.uuid) : false
  const hasAppendInstallRow = installing && installPlacement === 'append'
  const hasInsertAfterInstallRow = installing && installPlacement === 'insert-after'

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
    sortKey,
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
  const showTopLevelHeaderDrop = showCustomOrderBadge && draggedModIds.length > 0

  const {
    getContextTargetModIds,
    handleContextEnable,
    handleContextDisable,
    handleContextOpenFolder,
    handleContextOpenOnNexus,
    handleContextDelete,
    handleContextRename,
    handleContextDetails,
    handleContextReinstall,
    handleContextMoveSelectedHere,
    handleContextMoveToTopLevel,
  } = useLibraryContextMenuActions({
    contextMenu,
    selectedModIds,
    settings,
    enableMod,
    disableMod,
    addToast,
    openReinstallPrompt,
    moveModsToSeparator,
    moveModsToTopLevel,
    closeContextMenu,
    requestDelete,
    beginRename,
    openDetails,
  })

  const handleContextCreateSeparator = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'list') return
    handleCreateSeparator(contextMenu.insertIndex)
    closeContextMenu()
  }, [closeContextMenu, contextMenu, handleCreateSeparator])

  const handleContextCreateSeparatorAtEnd = useCallback(() => {
    handleCreateSeparator(displayedMods.length)
    closeContextMenu()
  }, [closeContextMenu, displayedMods.length, handleCreateSeparator])

  const handleContextCreateSeparatorBeforeRow = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'row') return

    const rowIndex = displayedMods.findIndex((entry) => entry.uuid === contextMenu.mod.uuid)
    handleCreateSeparator(rowIndex >= 0 ? rowIndex : undefined)
    closeContextMenu()
  }, [closeContextMenu, contextMenu, displayedMods, handleCreateSeparator])

  const handleRefreshLibrary = useCallback(async () => {
    closeContextMenu()
    await scanMods()
    addToast('Library refreshed', 'success', 1200)
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
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#050505]/90 border-[1px] border-[#fcee09]/40 pointer-events-none">
          <span className="material-symbols-outlined text-[48px] text-[#fcee09] mb-4">file_download</span>
          <span className="brand-font text-sm text-[#fcee09] tracking-widest uppercase">Drop to install mod</span>
        </div>
      )}

      <LibraryToolbar
        totalCount={totalCount}
        enabledCount={enabledCount}
        filter={filter}
        statusFilter={libraryStatusFilter}
        showCustomOrderBadge={showCustomOrderBadge}
        onFilterChange={handleFilterChange}
        onStatusFilterChange={setLibraryStatusFilter}
        onCreateSeparator={() => void handleCreateSeparator()}
        onDeleteAll={() => requestLibraryDeleteAll()}
        onInstallMod={handleInstallClick}
      />

        {/* Table — has its own scroll, toolbar stays fixed above */}
      <div className="flex-1 overflow-hidden px-8 pb-6 w-full">
        <HyperionPanel className="h-full overflow-hidden">
          <div ref={listScrollRef} className="hyperion-scrollbar managed-mods-scroll h-full overflow-y-auto">

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
            visibleMods={visibleMods}
            virtualStartIndex={virtualizedMods.startIndex}
            paddingTop={displayedMods.length > MOD_VIRTUALIZATION_THRESHOLD ? virtualizedMods.paddingTop : 0}
            paddingBottom={displayedMods.length > MOD_VIRTUALIZATION_THRESHOLD ? virtualizedMods.paddingBottom : 0}
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
            showAppendInstallRow={showAppendInstallRow}
            loadOrderMap={loadOrderMap}
            selectedSet={selectedSet}
            nestedModIds={nestedModIds}
            separatorParentByModId={separatorParentByModId}
            recentlyRevealedSeparatorId={recentlyRevealedSeparatorId}
            draggedModIds={draggedModIds}
            sortKey={sortKey}
            dropSeparatorId={dropSeparatorId}
            collapsedSeparatorSet={collapsedSeparatorSet}
            separatorSummaryTotal={separatorSummary.total}
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
          title={separatorDialog.mode === 'create' ? 'Create Separator' : 'Rename Separator'}
          description={separatorDialog.mode === 'create'
            ? 'Create a library divider for custom order. You can drag mods into it later or use Move to Separator from the selection bar.'
            : 'Update the label shown for this separator in Custom Order.'}
          value={separatorDialog.value}
          submitLabel={separatorDialog.mode === 'create' ? 'Create Separator' : 'Save Name'}
          onChange={handleSeparatorDialogValueChange}
          onSubmit={() => void handleSubmitSeparatorDialog()}
          onCancel={handleCancelSeparatorDialog}
          selectOnOpen={separatorDialog.mode === 'rename'}
          submitting={separatorDialogSubmitting}
        />
      )}

      {contextMenu && (
        <LibraryContextMenu
          menu={contextMenu}
          menuRef={contextMenuRef}
          selectedModCount={selectedModCount}
          hasSeparators={allSeparatorIds.length > 0}
          hasCollapsedSeparators={hasCollapsedSeparators}
          canMoveSelectedToTopLevel={sortKey === null}
          canMoveContextToTopLevel={sortKey === null}
          contextTargetCount={getContextTargetModIds().length}
          onRefreshLibrary={handleRefreshLibrary}
          onCreateSeparatorHere={handleContextCreateSeparator}
          onCreateSeparatorAtEnd={handleContextCreateSeparatorAtEnd}
          onMoveSelectedToTopLevel={handleMoveSelectedToTopLevel}
          onToggleAllSeparators={handleToggleAllSeparators}
          onCreateSeparatorBeforeRow={handleContextCreateSeparatorBeforeRow}
          onRename={handleContextRename}
          onMoveSelectedHere={handleContextMoveSelectedHere}
          onOpenFolder={handleContextOpenFolder}
          onDelete={handleContextDelete}
          onReinstall={handleContextReinstall}
          onDetails={handleContextDetails}
          onMoveContextToTopLevel={handleContextMoveToTopLevel}
          onEnable={handleContextEnable}
          onDisable={handleContextDisable}
          onOpenOnNexus={handleContextOpenOnNexus}
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
          selectedModCount={selectedModCount}
          canMove={sortKey === null}
          separators={allSeparators}
          moveMenuOpen={moveSeparatorMenuOpen}
          moveMenuRef={moveSeparatorMenuRef}
          onToggleMoveMenu={toggleMoveSeparatorMenu}
          onEnableSelected={() => runBulkToggle(selectedModIds, 'enable')}
          onDisableSelected={() => runBulkToggle(selectedModIds, 'disable')}
          onMoveToSeparator={handleMoveSelectedToSeparator}
          onMoveToTopLevel={() => moveModsToTopLevel(selectedModIds)}
          onDeleteSelected={() => setPendingAction({ type: 'delete-selected', count: selectedModCount, modIds: [...selectedModIds] })}
          onClearSelection={clearSelection}
        />
      )}
    </div>
    </div>
  )
}
