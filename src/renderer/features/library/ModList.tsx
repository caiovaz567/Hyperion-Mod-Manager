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
import { Tooltip } from '../ui/Tooltip'
import type { LibraryStatusFilter } from '../../store/slices/createLibrarySlice'

interface ContextMenuState {
  mod: ModMetadata
  x: number
  y: number
}

interface DetailOverlayState {
  modId: string
  initialEditName?: boolean
}

type PendingActionState =
  | { type: 'delete-all'; count: number }
  | { type: 'delete-selected'; count: number; modIds: string[] }

type LibrarySortKey = 'name' | 'type' | 'installedAt'
type SortDirection = 'asc' | 'desc'

const LIBRARY_GRID_TEMPLATE = '72px 80px minmax(280px,1fr) 110px 156px 184px 96px'

export const ModList: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const selectedIdsRef = useRef<string[]>([])
  const selectionAnchorIdRef = useRef<string | null>(null)
  const displayedModsRef = useRef<ModMetadata[]>([])
  const [pendingDeleteMod, setPendingDeleteMod] = useState<ModMetadata | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingActionState | null>(null)
  const [detailOverlay, setDetailOverlay] = useState<DetailOverlayState | null>(null)
  const [renamingModId, setRenamingModId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [submittingAction, setSubmittingAction] = useState(false)
  const [sortKey, setSortKey] = useState<LibrarySortKey | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const [isBulkToggling, setIsBulkToggling] = useState(false)

  const {
    filter,
    filteredMods,
    selectMod,
    installMod,
    enableMod,
    disableMod,
    deleteMod,
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
    installProgress,
    installStatus,
    installCurrentFile,
  } = useAppStore((state) => ({
    filter: state.filter,
    filteredMods: state.filteredMods,
    selectMod: state.selectMod,
    installMod: state.installMod,
    enableMod: state.enableMod,
    disableMod: state.disableMod,
    deleteMod: state.deleteMod,
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
    installProgress: state.installProgress,
    installStatus: state.installStatus,
    installCurrentFile: state.installCurrentFile,
  }), shallow)

  const hasRequiredPaths = Boolean(settings?.gamePath?.trim() && settings?.libraryPath?.trim() && gamePathValid && libraryPathValid)

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

  const allMods = mods.filter((mod) => mod.kind === 'mod')
  const enabledCount = allMods.filter((mod) => mod.enabled).length
  const disabledCount = allMods.filter((mod) => !mod.enabled).length
  const totalCount = allMods.length
  const baseFilteredMods = useMemo(() => filteredMods().filter((mod) => mod.kind === 'mod'), [mods, filter, typeFilter, filteredMods])
  const enabledVisibleCount = baseFilteredMods.filter((mod) => mod.enabled).length
  const disabledVisibleCount = baseFilteredMods.filter((mod) => !mod.enabled).length

  const displayedMods = useMemo(() => {
    const filteredByStatus = libraryStatusFilter === 'enabled'
      ? baseFilteredMods.filter((mod) => mod.enabled)
      : libraryStatusFilter === 'disabled'
        ? baseFilteredMods.filter((mod) => !mod.enabled)
        : baseFilteredMods

    if (sortKey === null) return filteredByStatus

    const sorted = [...filteredByStatus].sort((left, right) => {
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
  }, [baseFilteredMods, libraryStatusFilter, sortDirection, sortKey])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedMods = useMemo(() => allMods.filter((mod) => selectedIds.includes(mod.uuid)), [allMods, selectedIds])
  const selectedModsPreview = useMemo(() => selectedMods.slice(0, 6), [selectedMods])
  const loadOrderMap = useMemo(() => {
    const map = new Map<string, number>()
    allMods.forEach((mod, i) => map.set(mod.uuid, i + 1))
    return map
  }, [allMods])
  const visibleModIds = displayedMods.map((mod) => mod.uuid)
  const visibleEnabledCount = displayedMods.filter((mod) => mod.enabled).length
  const allVisibleEnabled = displayedMods.length > 0 && visibleEnabledCount === displayedMods.length
  const bulkSelectionActive = selectedIds.length > 1
  const bulkToggleDisabled = libraryStatusFilter !== 'all'
  const bulkToggleTooltip = libraryStatusFilter === 'enabled'
    ? 'Unavailable while Enabled filter is active'
    : 'Unavailable while Disabled filter is active'

  selectedIdsRef.current = selectedIds
  selectionAnchorIdRef.current = selectionAnchorId
  displayedModsRef.current = displayedMods

  const sortStateFor = (key: LibrarySortKey): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== key) return 'none'
    return sortDirection === 'asc' ? 'ascending' : 'descending'
  }

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => allMods.some((mod) => mod.uuid === id)))
  }, [allMods])

  useEffect(() => {
    if (!renamingModId) return
    const renamedMod = allMods.find((mod) => mod.uuid === renamingModId)
    if (!renamedMod) {
      setRenamingModId(null)
      setRenameValue('')
      return
    }
    setRenameValue(renamedMod.name)
  }, [renamingModId, allMods])

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
      const visibleIds = displayedMods.map((mod) => mod.uuid)
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
    if (!libraryDeleteAllRequestedAt) return
    setPendingAction({ type: 'delete-all', count: totalCount })
    clearLibraryDeleteAllRequest()
  }, [libraryDeleteAllRequestedAt, totalCount, clearLibraryDeleteAllRequest])

  const handleInstallFile = useCallback(async (filePath: string) => {
    if (!hasRequiredPaths) {
      addToast('Set Game Path and Mod Library before installing mods', 'warning')
      setActiveView('settings')
      return
    }

    setIsInstalling(true)
    const installResult = await installMod(filePath)
    if (!installResult.ok || !installResult.data) {
      addToast(installResult.error ?? 'Install failed', 'error')
      setIsInstalling(false)
      return
    }

    setIsInstalling(false)

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

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    if (!isDragging) setIsDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }

  const handleDrop = async (event: React.DragEvent) => {
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
    setContextMenu({ mod, x: event.clientX, y: event.clientY })
  }

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
    if (mod.kind !== 'mod') {
      selectMod(mod.uuid)
      return
    }

    const currentDisplayedMods = displayedModsRef.current
    const currentSelectedIds = selectedIdsRef.current
    const currentSelectionAnchorId = selectionAnchorIdRef.current
    const resolvedAnchorId = currentSelectionAnchorId ?? currentSelectedIds[0] ?? null
    const anchorIndex = resolvedAnchorId
      ? currentDisplayedMods.findIndex((item) => item.uuid === resolvedAnchorId)
      : -1

    if (event.shiftKey && anchorIndex >= 0) {
      const start = Math.min(anchorIndex, index)
      const end = Math.max(anchorIndex, index)
      const rangeIds = currentDisplayedMods
        .slice(start, end + 1)
        .filter((item) => item.kind === 'mod')
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
  }, [selectMod])

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
    const targets = [...allMods]
    if (targets.length === 0) {
      addToast('No mods to delete', 'info')
      return
    }

    setSubmittingAction(true)
    let removed = 0
    let failed = 0

    for (const mod of targets) {
      const result = await deleteMod(mod.uuid)
      if (result.ok) {
        removed += 1
      } else {
        failed += 1
      }
    }

    setSubmittingAction(false)
    setPendingAction(null)
    setSelectedIds([])
    setSelectionAnchorId(null)

    if (removed > 0) {
      addToast(`${removed} mod${removed === 1 ? '' : 's'} deleted from the library`, 'success')
    }
    if (failed > 0) {
      addToast(`${failed} mod${failed === 1 ? '' : 's'} could not be deleted`, 'warning')
    }
  }, [allMods, addToast, deleteMod])

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
      const result = await deleteMod(mod.uuid)
      if (result.ok) {
        removed += 1
      } else {
        failed += 1
      }
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
  }, [allMods, addToast, deleteMod])

  const handleContextEnable = async () => {
    if (!contextMenu) return
    const result = await enableMod(contextMenu.mod.uuid)
    if (!result.ok) addToast(result.error ?? 'Enable failed', 'error')
    setContextMenu(null)
  }

  const handleContextDisable = async () => {
    if (!contextMenu) return
    const result = await disableMod(contextMenu.mod.uuid)
    if (!result.ok) addToast(result.error ?? 'Disable failed', 'error')
    setContextMenu(null)
  }

  const handleContextOpenFolder = async () => {
    if (!contextMenu || !settings?.libraryPath) return
    const modPath = `${settings.libraryPath}\\${contextMenu.mod.folderName ?? contextMenu.mod.uuid}`
    await IpcService.invoke(IPC.OPEN_PATH, modPath)
    setContextMenu(null)
  }

  const handleDeleteMod = async (mod: ModMetadata) => {
    const result = await deleteMod(mod.uuid)
    if (!result.ok) {
      addToast(result.error ?? 'Delete failed', 'error')
    } else {
      addToast(`${mod.name} deleted`, 'success')
    }
  }

  const handleContextDelete = async () => {
    if (!contextMenu) return
    setPendingDeleteMod(contextMenu.mod)
    setContextMenu(null)
  }

  const handleContextRename = () => {
    if (!contextMenu) return
    setRenamingModId(contextMenu.mod.uuid)
    setRenameValue(contextMenu.mod.name)
    setContextMenu(null)
  }

  const handleContextDetails = () => {
    if (!contextMenu) return
    setDetailOverlay({ modId: contextMenu.mod.uuid })
    setContextMenu(null)
  }

  const handleContextReinstall = async () => {
    if (!contextMenu) return
    if (!contextMenu.mod.sourcePath) {
      addToast('Original source is not stored for this mod', 'warning')
      setContextMenu(null)
      return
    }

    openReinstallPrompt(contextMenu.mod)

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
  const darkBrowseLikeButtonClass = `${browseLikeButtonClass} border-[#fcee09]/30 bg-[#0a0a0a] text-[#fcee09] hover:bg-[#fcee09] hover:text-[#050505]`
  const activeBrowseLikeButtonClass = `${browseLikeButtonClass} border-[#fcee09] bg-[#fcee09] text-[#050505]`
  const destructiveButtonClass = `${browseLikeButtonClass} border-[#5b1818] bg-[#160707] text-[#f18d8d] hover:border-[#f87171] hover:bg-[#2a0909] hover:text-[#ffe1e1]`
  const disabledBrowseLikeButtonClass = `${browseLikeButtonClass} cursor-not-allowed border-[#303030] bg-[#131313] text-[#666666] shadow-none`

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

      {isInstalling && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#050505]/92 pointer-events-none px-16">
          <span className="material-symbols-outlined text-[36px] text-[#fcee09] mb-5 animate-spin">progress_activity</span>
          <span className="brand-font text-sm text-white tracking-widest uppercase mb-1">
            {installStatus || 'Installing...'}
          </span>
          {installCurrentFile && (
            <span className="font-mono text-[11px] text-[#7a7a7a] mb-4 max-w-[480px] truncate text-center">
              {installCurrentFile}
            </span>
          )}
          <div className="w-full max-w-[420px] mt-2">
            <div className="h-[3px] bg-[#1a1a1a] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#fcee09] transition-all duration-300"
                style={{ width: `${installProgress}%`, boxShadow: '0 0 8px rgba(252,238,9,0.5)' }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="font-mono text-[10px] text-[#5a5a5a]">{installProgress}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Fixed header — does not scroll */}
      <div className="shrink-0 px-8 pt-6 pb-3 w-full">
        <div className="flex items-center gap-2">
          <h1 className="brand-font text-xl text-white font-bold tracking-widest uppercase">
            Managed Mods
          </h1>
          <Tooltip
            content="Shift+Click selects ranges · Ctrl+Click adds individual mods · Ctrl+A selects all visible mods"
            side="bottom"
          >
            <span className="material-symbols-outlined text-[16px] text-[#4a4a4a] hover:text-[#7a7a7a] transition-colors cursor-default mt-0.5">
              help_outline
            </span>
          </Tooltip>
        </div>
        <p className="text-[#9a9a9a] text-xs mt-1 flex items-center gap-2 font-mono tracking-tight">
          TOTAL: {totalCount} &nbsp;|&nbsp; ACTIVE: {enabledCount}
        </p>
        <div className="mt-3 flex items-center gap-3">
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
          </div>

          <button
            onClick={handleInstallClick}
            className="flex h-10 shrink-0 items-center whitespace-nowrap rounded-sm bg-[#fcee09] px-5 text-xs brand-font font-bold uppercase tracking-widest text-[#050505] transition-colors shadow-[0_0_20px_rgba(252,238,9,0.15)] hover:bg-white"
          >
            Install Mod
          </button>

          <div className="h-5 w-px bg-[#2a2a2a]" />

          <Tooltip content="Delete every mod from the current library">
            <button
              onClick={() => requestLibraryDeleteAll()}
              className="flex h-10 w-10 items-center justify-center rounded-sm border-[0.5px] border-[#3a1010] bg-[#0d0404] text-[#f18d8d] transition-colors hover:border-[#f87171] hover:bg-[#1a0505] hover:text-[#ffe1e1]"
            >
              <span className="material-symbols-outlined text-[22px]">delete_forever</span>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Table — has its own scroll, toolbar stays fixed above */}
      <div className="flex-1 overflow-hidden px-8 pb-6 w-full">
        <div className="h-full bg-[#050505] rounded-sm border-[0.5px] border-[#1a1a1a] overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.24)] flex flex-col">

          {/* Column header — never scrolls */}
          <div
            className="shrink-0 grid gap-4 px-6 border-b-[0.5px] border-[#1a1a1a] bg-[#070707]"
            style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
          >
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
                    className={`relative h-5 w-10 rounded-full border-[0.5px] transition-all duration-200 ${
                      bulkToggleDisabled
                        ? 'cursor-not-allowed border-[#1a1a1a] bg-[#0a0a0a]'
                        : isBulkToggling
                          ? 'cursor-wait border-[#4fd8ff]/50 bg-[#041a20] animate-cyan-glow'
                          : allVisibleEnabled
                            ? 'border-[#4fd8ff]/55 bg-[#041a20] shadow-[0_0_10px_rgba(79,216,255,0.2)] hover:border-[#4fd8ff]/75'
                            : 'border-[#222] bg-[#111] hover:border-[#333]'
                    }`}
                  >
                    <div className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all duration-200 ${
                      bulkToggleDisabled
                        ? 'left-[2px] bg-[#2a2a2a]'
                        : allVisibleEnabled
                          ? 'right-[2px] bg-[#4fd8ff]'
                          : 'left-[2px] bg-[#5a5a5a]'
                    }`} />
                  </button>
                </span>
              </Tooltip>
            </div>
            <div className="flex h-8 items-center text-xs uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">#</div>
            <button
              onClick={() => handleSort('name')}
              aria-label={`Sort by mod name${sortKey === 'name' ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
              className="flex h-8 w-full items-center justify-start gap-0.5 text-left"
            >
              <span className={`text-xs uppercase tracking-widest brand-font font-bold ${sortKey === 'name' ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'}`}>
                Mod Name
              </span>
              <span className={`material-symbols-outlined text-[8px] leading-none ${sortKey === 'name' ? 'text-[#fcee09]' : 'text-[#727272]'}`} aria-hidden="true">{sortKey === 'name' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span>
            </button>
            <div className="flex h-8 items-center text-xs uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">Version</div>
            <button
              onClick={() => handleSort('type')}
              aria-label={`Sort by type${sortKey === 'type' ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
              className="flex h-8 w-full items-center justify-start gap-0.5 text-left"
            >
              <span className={`text-xs uppercase tracking-widest brand-font font-bold ${sortKey === 'type' ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'}`}>
                Type
              </span>
              <span className={`material-symbols-outlined text-[8px] leading-none ${sortKey === 'type' ? 'text-[#fcee09]' : 'text-[#727272]'}`} aria-hidden="true">{sortKey === 'type' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span>
            </button>
            <button
              onClick={() => handleSort('installedAt')}
              aria-label={`Sort by installed date${sortKey === 'installedAt' ? `, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
              className="flex h-8 w-full items-center justify-start gap-0.5 text-left"
            >
              <span className={`text-xs uppercase tracking-widest brand-font font-bold ${sortKey === 'installedAt' ? 'text-[#fcee09]' : 'text-[#9d9d9d] hover:text-[#fcee09]'}`}>
                Date
              </span>
              <span className={`material-symbols-outlined text-[8px] leading-none ${sortKey === 'installedAt' ? 'text-[#fcee09]' : 'text-[#727272]'}`} aria-hidden="true">{sortKey === 'installedAt' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span>
            </button>
            <div className="flex h-8 items-center justify-end text-xs uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">Actions</div>
          </div>

          {/* Scrollable rows */}
          <div className="hyperion-scrollbar managed-mods-scroll flex-1 overflow-y-auto">
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
              <div>
                {displayedMods.map((mod, index) => (
                  <MemoModRow
                    key={mod.uuid}
                    mod={mod}
                    index={loadOrderMap.get(mod.uuid) ?? index + 1}
                    selected={selectedSet.has(mod.uuid)}
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
                  />
                ))}
              </div>
            )}
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

      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-[100] bg-[#0a0a0a] border-[0.5px] border-[#222] shadow-[0_10px_30px_rgba(0,0,0,0.5)] py-1 min-w-[220px] brand-font"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
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
          <button
            onClick={handleContextOpenFolder}
            className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
          >
            <span className="material-symbols-outlined text-[16px]">folder_open</span>
            <span>Open in File Explorer</span>
          </button>
          <div className="my-1 border-t-[0.5px] border-[#222]" />
          <button
            onClick={handleContextReinstall}
            className="flex items-center w-full px-4 py-2 text-[11px] text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09] transition-colors gap-3 tracking-wider font-semibold uppercase"
          >
            <span className="material-symbols-outlined text-[16px]">settings_backup_restore</span>
            <span>Reinstall</span>
          </button>
          <button
            onClick={handleContextDelete}
            className="flex items-center w-full px-4 py-2 text-[11px] text-[#ffb4ab] hover:bg-[#93000a]/10 transition-colors gap-3 tracking-wider font-semibold uppercase"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
            <span>Delete</span>
          </button>
        </div>,
        document.body
      )}

      {pendingDeleteMod && (
        <ActionPromptDialog
          accentColor="#ff4d4f"
          accentGlow="rgba(255,77,79,0.45)"
          title="Delete Mod"
          description={`You are about to permanently delete ${pendingDeleteMod.name} from your mod library.`}
          detailLabel="Target mod"
          detailValue={pendingDeleteMod.name}
          icon="delete"
          primaryLabel="Delete"
          onPrimary={() => handleDeleteMod(pendingDeleteMod).then(() => setPendingDeleteMod(null))}
          onCancel={() => setPendingDeleteMod(null)}
          primaryTextColor="#ffffff"
        />
      )}

      {pendingAction?.type === 'delete-all' && (
        <ActionPromptDialog
          accentColor="#ff4d4f"
          accentGlow="rgba(255,77,79,0.4)"
          title="Delete Entire Library"
          description="This permanently deletes every mod currently listed in this library. Enabled mods are removed from the game first, then erased from the library itself."
          detailLabel="Installed mods"
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
                <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-[#8d8d8d]">
                  Mods being uninstalled
                </div>
                <div className="rounded-sm border-[0.5px] border-[#4a1c1c] bg-[#160909] px-2 py-1 text-[9px] font-mono uppercase tracking-[0.14em] text-[#ffb4ab]">
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
              onClick={() => void runBulkToggle(selectedIds, 'enable')}
              className={`${darkBrowseLikeButtonClass} gap-1.5 px-4 text-[9px]`}
            >
              <span className="material-symbols-outlined text-[15px]">check_circle</span>
              Enable
            </button>
            <button
              onClick={() => void runBulkToggle(selectedIds, 'disable')}
              className={`${darkBrowseLikeButtonClass} gap-1.5 px-4 text-[9px]`}
            >
              <span className="material-symbols-outlined text-[15px]">do_not_disturb_on</span>
              Disable
            </button>
            <button
              onClick={() => setPendingAction({ type: 'delete-selected', count: selectedIds.length, modIds: [...selectedIds] })}
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
