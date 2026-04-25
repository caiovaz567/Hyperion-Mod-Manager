import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shallow } from 'zustand/shallow'
import type {
  ModMetadata,
  IpcResult,
  ModTreeCreateEntryRequest,
  ModTreeRenameEntryRequest,
  ModTreeDeleteEntryRequest,
  ConflictInfo,
} from '@shared/types'
import { IPC } from '@shared/types'
import { IpcService } from '../../services/IpcService'
import { useAppStore } from '../../store/useAppStore'
import { Tooltip } from '../ui/Tooltip'
import { ActionPromptDialog } from '../ui/ActionPromptDialog'
import { SeparatorNameDialog } from '../ui/SeparatorNameDialog'
import {
  ConflictSection,
  FileTreeBranch,
  TabButton,
  detailTitleClass,
  detailToolbarButtonClass,
} from './DetailPanelParts'
import type {
  DetailTab,
  DetailViewport,
  FileTreeEntry,
  FileTreeNode,
  TreeActionDialogState,
  TreeContextMenuState,
} from './DetailPanelTypes'
import {
  buildFileTree,
  collectDefaultExpandedIds,
  collectFolderIds,
  collectVisibleNodeIds,
  filterFileTree,
  findFileTreeNode,
  getCreateParentRelativePath,
  getDeployRelativeFolderPath,
  getDeployRelativePath,
  getExistingNodeRelativePath,
  joinWindowsPath,
  normalizeRelativePath,
} from './detailFileTreeUtils'

interface DetailPanelProps {
  modId: string
  onClose: () => void
  initialTab?: 'files' | 'conflicts'
  initialEditName?: boolean
}

function getDetailViewport(): DetailViewport {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0, screenWidth: 0, screenHeight: 0 }
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
    screenWidth: window.screen?.availWidth ?? window.innerWidth,
    screenHeight: window.screen?.availHeight ?? window.innerHeight,
  }
}

function isIncomingConflictForMod(conflict: ConflictInfo, mod: ModMetadata): boolean {
  return (
    conflict.incomingModId === mod.uuid
    || (
      conflict.incomingModName === mod.name
      && typeof conflict.incomingOrder === 'number'
      && conflict.incomingOrder === mod.order
    )
  )
}

function dedupeConflicts(conflicts: ConflictInfo[]): ConflictInfo[] {
  const seen = new Set<string>()

  return conflicts.filter((conflict) => {
    const key = `${conflict.kind}:${conflict.resourcePath}:${conflict.existingModId}:${conflict.incomingModId ?? conflict.incomingModName}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const treeMenuButtonClass = 'flex w-full items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#e5e2e1] transition-colors hover:bg-[#111] hover:text-[#fcee09]'
const treeMenuDangerButtonClass = 'flex w-full items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ffb4ab] transition-colors hover:bg-[#93000a]/10'

export const DetailPanel: React.FC<DetailPanelProps> = ({
  modId,
  onClose,
  initialTab = 'files',
  initialEditName = false,
}) => {
  const {
    mods,
    conflicts,
    updateModMetadata,
    scanMods,
    addToast,
    settings,
  } = useAppStore((state) => ({
    mods: state.mods,
    conflicts: state.conflicts,
    updateModMetadata: state.updateModMetadata,
    scanMods: state.scanMods,
    addToast: state.addToast,
    settings: state.settings,
  }), shallow)

  const mod = mods.find((item) => item.uuid === modId)
  const resolvedInitialTab: DetailTab = initialTab === 'conflicts' ? 'conflicts' : 'files'
  const [activeTab, setActiveTab] = useState<DetailTab>(resolvedInitialTab)
  const [editingName, setEditingName] = useState(initialEditName)
  const [nameValue, setNameValue] = useState(mod?.name ?? '')
  const [nameSaving, setNameSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [expandedTreeIds, setExpandedTreeIds] = useState<Set<string>>(new Set())
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null)
  const [treeActionDialog, setTreeActionDialog] = useState<TreeActionDialogState | null>(null)
  const [treeActionValue, setTreeActionValue] = useState('')
  const [treeActionSubmitting, setTreeActionSubmitting] = useState(false)
  const [winConflictsCollapsed, setWinConflictsCollapsed] = useState(false)
  const [lossConflictsCollapsed, setLossConflictsCollapsed] = useState(false)
  const [viewport, setViewport] = useState<DetailViewport>(() => getDetailViewport())
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const treeContextMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setActiveTab(initialTab === 'conflicts' ? 'conflicts' : 'files')
    setEditingName(initialEditName)
  }, [initialEditName, initialTab, modId])

  useEffect(() => {
    setNameValue(mod?.name ?? '')
    setSearchQuery('')
    setSelectedNodeId(null)
    setTreeContextMenu(null)
    setTreeActionDialog(null)
    setTreeActionValue('')
    setWinConflictsCollapsed(false)
    setLossConflictsCollapsed(false)
  }, [mod?.name, mod?.uuid])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && activeTab === 'files') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, onClose])

  useEffect(() => {
    const handleResize = () => setViewport(getDetailViewport())

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const visibleFiles = useMemo(
    () => mod?.files.filter((file) => file !== '_metadata.json') ?? [],
    [mod?.files]
  )

  const fileTreeUsesDeployedPaths = useMemo(
    () => Boolean(mod?.deployedPaths?.some((value) => value.trim().length > 0)),
    [mod?.deployedPaths]
  )

  const sourcePathByDeployPath = useMemo(() => {
    if (!mod) return new Map<string, string>()

    return new Map(
      visibleFiles.map((file) => ([
        normalizeRelativePath(getDeployRelativePath(mod, file)),
        normalizeRelativePath(file),
      ]))
    )
  }, [mod, visibleFiles])

  const fileTreeEntries = useMemo(() => {
    if (!mod) return []

    const entriesByDeployPath = new Map<string, FileTreeEntry>()

    const registerEntry = (entry: FileTreeEntry) => {
      const normalizedDeployPath = normalizeRelativePath(entry.deployPath)
      if (!normalizedDeployPath) return

      const normalizedSourcePath = entry.sourcePath
        ? normalizeRelativePath(entry.sourcePath)
        : undefined
      const nextEntry: FileTreeEntry = {
        deployPath: normalizedDeployPath,
        kind: entry.kind,
        sourcePath: normalizedSourcePath,
      }
      const existingEntry = entriesByDeployPath.get(normalizedDeployPath)

      if (!existingEntry) {
        entriesByDeployPath.set(normalizedDeployPath, nextEntry)
        return
      }

      if (existingEntry.kind === 'folder' && nextEntry.kind === 'file') {
        entriesByDeployPath.set(normalizedDeployPath, nextEntry)
        return
      }

      if (!existingEntry.sourcePath && nextEntry.sourcePath) {
        entriesByDeployPath.set(normalizedDeployPath, {
          ...existingEntry,
          sourcePath: nextEntry.sourcePath,
        })
      }
    }

    if (fileTreeUsesDeployedPaths) {
      ;(mod.deployedPaths ?? []).forEach((deployPath, index) => {
        const normalizedDeployPath = normalizeRelativePath(deployPath)
        registerEntry({
          deployPath: normalizedDeployPath,
          kind: 'file',
          sourcePath: visibleFiles[index] ?? sourcePathByDeployPath.get(normalizedDeployPath),
        })
      })
    } else {
      visibleFiles.forEach((file) => {
        registerEntry({
          deployPath: getDeployRelativePath(mod, file),
          kind: 'file',
          sourcePath: file,
        })
      })
    }

    ;(mod.emptyDirs ?? []).forEach((emptyDir) => {
      const normalizedSourcePath = normalizeRelativePath(emptyDir)
      if (!normalizedSourcePath) return

      registerEntry({
        deployPath: getDeployRelativeFolderPath(mod, normalizedSourcePath),
        kind: 'folder',
        sourcePath: normalizedSourcePath,
      })
    })

    return Array.from(entriesByDeployPath.values())
  }, [fileTreeUsesDeployedPaths, mod, sourcePathByDeployPath, visibleFiles])

  const fileTree = useMemo(
    () => buildFileTree(fileTreeEntries),
    [fileTreeEntries]
  )

  const defaultExpandedTreeIds = useMemo(
    () => collectDefaultExpandedIds(fileTree),
    [fileTree]
  )

  const filteredFileTree = useMemo(
    () => filterFileTree(fileTree, searchQuery),
    [fileTree, searchQuery]
  )

  const searchExpandedTreeIds = useMemo(
    () => collectFolderIds(filteredFileTree),
    [filteredFileTree]
  )

  const displayedExpandedIds = searchQuery.trim()
    ? searchExpandedTreeIds
    : expandedTreeIds

  const visibleNodeIds = useMemo(
    () => collectVisibleNodeIds(filteredFileTree),
    [filteredFileTree]
  )

  const winConflicts = useMemo(
    () => mod ? dedupeConflicts(conflicts.filter((conflict) => isIncomingConflictForMod(conflict, mod))) : [],
    [conflicts, mod]
  )

  const lossConflicts = useMemo(
    () => mod ? dedupeConflicts(conflicts.filter((conflict) => conflict.existingModId === mod.uuid)) : [],
    [conflicts, mod]
  )

  useEffect(() => {
    setExpandedTreeIds(new Set(defaultExpandedTreeIds))
  }, [defaultExpandedTreeIds, mod?.uuid])

  // Auto-collapse sections that have no conflicts when switching mods
  useEffect(() => {
    setWinConflictsCollapsed(winConflicts.length === 0)
    setLossConflictsCollapsed(lossConflicts.length === 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modId])

  useEffect(() => {
    if (selectedNodeId && visibleNodeIds.has(selectedNodeId)) return
    setSelectedNodeId(null)
  }, [selectedNodeId, visibleNodeIds])

  useEffect(() => {
    if (!treeContextMenu) return

    const closeMenu = () => setTreeContextMenu(null)
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (treeContextMenuRef.current && target instanceof Node && treeContextMenuRef.current.contains(target)) return
      closeMenu()
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [treeContextMenu])

  const toggleTreeNode = (id: string) => {
    setExpandedTreeIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (!mod) return null

  const modFolderPath = settings?.libraryPath?.trim()
    ? joinWindowsPath(settings.libraryPath, mod.folderName ?? mod.uuid)
    : null
  const nameDirty = nameValue.trim() !== mod.name
  const conflictSummary = mod.conflictSummary ?? {
    overwrites: winConflicts.length,
    overwrittenBy: lossConflicts.length,
  }
  const fileTreeModeDescription = fileTreeUsesDeployedPaths
    ? 'Showing the last known deployment structure relative to the game root.'
    : 'Showing the inferred deployment structure based on indexed files and mod type.'
  const fullscreenLikeViewport = Math.abs(viewport.screenWidth - viewport.width) <= 48
    && Math.abs(viewport.screenHeight - viewport.height) <= 72
  const detailPanelFrameStyle: React.CSSProperties = {
    height: fullscreenLikeViewport
      ? 'min(1040px, calc(100vh - 12px))'
      : 'min(980px, calc(100vh - 24px))',
    width: fullscreenLikeViewport
      ? 'min(1240px, calc(100vw - 60px))'
      : 'min(1480px, calc(100vw - 24px))',
    maxWidth: fullscreenLikeViewport ? '1240px' : '1480px',
  }
  const contextMenuNode = findFileTreeNode(fileTree, treeContextMenu?.nodeId ?? null)
  const contextMenuExistingRelativePath = getExistingNodeRelativePath(contextMenuNode)
  const contextMenuRevealPath = contextMenuNode
    ? (
      fileTreeUsesDeployedPaths && settings?.gamePath?.trim()
        ? joinWindowsPath(settings.gamePath, contextMenuNode.path)
        : contextMenuNode.sourcePath && modFolderPath
          ? joinWindowsPath(modFolderPath, contextMenuNode.sourcePath)
          : modFolderPath
    )
    : modFolderPath
  const contextMenuCanRename = Boolean(contextMenuNode && contextMenuExistingRelativePath)
  const contextMenuCanDelete = Boolean(contextMenuNode && contextMenuExistingRelativePath)

  const handleSaveName = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed) {
      addToast('Mod name cannot be empty', 'warning')
      return
    }

    if (trimmed === mod.name) {
      setEditingName(false)
      return
    }

    setNameSaving(true)
    await updateModMetadata(mod.uuid, { name: trimmed })
    setNameSaving(false)
    setEditingName(false)
    addToast('Mod name updated', 'success', 1800)
  }

  const handleCancelNameEdit = () => {
    setNameValue(mod.name)
    setEditingName(false)
  }

  const handleOpenFolder = async () => {
    if (!modFolderPath) {
      addToast('Library path is not configured', 'warning')
      return
    }

    await IpcService.invoke(IPC.OPEN_PATH, modFolderPath)
  }

  const handleOpenNodeLocation = async (node: FileTreeNode | null, revealPath: string | null) => {
    if (!node || !revealPath) {
      addToast('Select a file or folder first', 'warning')
      return
    }

    if (node.kind === 'file') {
      await IpcService.invoke(IPC.SHOW_ITEM_IN_FOLDER, revealPath)
      return
    }

    await IpcService.invoke(IPC.OPEN_PATH, revealPath)
  }

  const handleTreeNodeContextMenu = (event: React.MouseEvent, node: FileTreeNode) => {
    event.preventDefault()
    event.stopPropagation()
    setSelectedNodeId(node.id)
    setTreeContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
  }

  const handleTreeBlankContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setTreeContextMenu({ x: event.clientX, y: event.clientY, nodeId: null })
  }

  const openTreeActionDialog = (mode: TreeActionDialogState['mode'], nodeId: string | null) => {
    setTreeContextMenu(null)
    setTreeActionDialog(mode === 'delete' ? { mode, nodeId: nodeId ?? '' } : { mode, nodeId })
    setTreeActionValue(
      mode === 'rename'
        ? findFileTreeNode(fileTree, nodeId)?.name ?? ''
        : ''
    )
  }

  const handleSubmitTreeAction = async () => {
    if (!treeActionDialog) return

    const targetNode = findFileTreeNode(fileTree, treeActionDialog.nodeId ?? null)
    setTreeActionSubmitting(true)

    let result: IpcResult<ModMetadata>
    let successMessage = 'Tree updated'

    if (treeActionDialog.mode === 'create-folder') {
      const request: ModTreeCreateEntryRequest = {
        modId: mod.uuid,
        kind: 'folder',
        name: treeActionValue,
        parentRelativePath: getCreateParentRelativePath(targetNode),
      }
      result = await IpcService.invoke<IpcResult<ModMetadata>>(IPC.MOD_TREE_CREATE_ENTRY, request)
      successMessage = 'Folder created'
    } else if (treeActionDialog.mode === 'rename') {
      const relativePath = getExistingNodeRelativePath(targetNode)
      if (!relativePath) {
        setTreeActionSubmitting(false)
        addToast('This entry cannot be renamed from the deploy tree view', 'warning')
        return
      }

      const request: ModTreeRenameEntryRequest = {
        modId: mod.uuid,
        relativePath,
        nextName: treeActionValue,
      }
      result = await IpcService.invoke<IpcResult<ModMetadata>>(IPC.MOD_TREE_RENAME_ENTRY, request)
      successMessage = 'Entry renamed'
    } else {
      const relativePath = getExistingNodeRelativePath(targetNode)
      if (!relativePath) {
        setTreeActionSubmitting(false)
        addToast('This entry cannot be deleted from the deploy tree view', 'warning')
        return
      }

      const request: ModTreeDeleteEntryRequest = {
        modId: mod.uuid,
        relativePath,
      }
      result = await IpcService.invoke<IpcResult<ModMetadata>>(IPC.MOD_TREE_DELETE_ENTRY, request)
      successMessage = 'Entry deleted'
    }

    setTreeActionSubmitting(false)

    if (!result.ok) {
      addToast(result.error ?? 'File tree action failed', 'error')
      return
    }

    await scanMods()
    setTreeActionDialog(null)
    setTreeActionValue('')
    setSelectedNodeId(null)
    addToast(successMessage, 'success', 1800)
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[160] flex items-center justify-center bg-[rgba(0,0,0,0.86)] px-6 backdrop-blur-[3px] fade-in ${
        fullscreenLikeViewport ? 'py-1.5' : 'py-3'
      }`}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col overflow-hidden border border-[#2a2a2a] bg-[linear-gradient(180deg,rgba(12,12,12,0.99),rgba(8,8,8,1))] shadow-[0_32px_80px_rgba(0,0,0,0.58)]"
        style={detailPanelFrameStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="absolute left-0 top-0 h-[2px] w-full bg-[#fcee09] shadow-[0_0_18px_rgba(252,238,9,0.32)]" />

        <div className="pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden="true">
          <div className="absolute -left-10 top-0 h-36 w-80 bg-[linear-gradient(90deg,rgba(252,238,9,0.8),rgba(252,238,9,0))] blur-[72px]" />
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col px-8 pb-7 pt-7">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-3">
                <h2 className={`min-w-0 flex-1 whitespace-normal break-words text-[#f5f1ee] ${detailTitleClass}`}>
                  {mod.name}
                </h2>
              </div>

              <div className="mt-6 flex items-end justify-between gap-4">
                <div className="flex items-end gap-6">
                  <TabButton active={activeTab === 'files'} label="Files" onClick={() => setActiveTab('files')} />
                  <TabButton active={activeTab === 'conflicts'} label="Conflicts" onClick={() => setActiveTab('conflicts')} />
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3 self-start">
              <span className={`inline-flex h-10 items-center border px-3 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                mod.enabled
                  ? 'border-[#21492f] bg-[#0b2214] text-[#4ff38f]'
                  : 'border-[#2d2d2d] bg-[#131313] text-[#c8c8c8]'
              }`}>
                <span>{mod.enabled ? 'Enabled' : 'Disabled'}</span>
              </span>

              <Tooltip content="Rename mod">
                <button
                  onClick={() => {
                    setNameValue(mod.name)
                    setEditingName(true)
                  }}
                  className="flex h-10 w-10 items-center justify-center border border-[#2a2a2a] bg-[#101010] text-[#959595] transition-colors hover:border-[#4a4a4a] hover:text-white"
                >
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                </button>
              </Tooltip>

              <Tooltip content="Close details">
                <button
                  onClick={onClose}
                  className="flex h-10 w-10 items-center justify-center border border-[#2b2b2b] bg-[#111] text-[#a3a3a3] transition-colors hover:border-[#4b4b4b] hover:text-white"
                >
                  <span className="material-symbols-outlined text-[21px]">close</span>
                </button>
              </Tooltip>
            </div>
          </div>

          {activeTab === 'files' ? (
            <div className="mt-5 flex min-h-0 flex-1 flex-col gap-4">
              <div className="grid gap-3 xl:grid-cols-[auto_minmax(0,1fr)]">
                <button
                  type="button"
                  onClick={() => void handleOpenFolder()}
                  className={detailToolbarButtonClass}
                >
                  <span className="material-symbols-outlined text-[16px]">folder_open</span>
                  <span>Open Mod Folder</span>
                </button>

                <label className="group relative min-w-[300px] flex-1">
                  <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[#6a6a6a] transition-colors group-hover:text-[#e8e8e8] group-focus-within:text-[#fcee09]">
                    search
                  </span>
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search files..."
                    className="h-10 w-full rounded-sm border-[0.5px] border-[#fcee09]/50 bg-[#0a0a0a] py-1.5 pl-10 pr-[88px] text-sm text-[#e5e2e1] placeholder-[#6f6f6f] transition-all hover:border-[#fcee09]/70 hover:text-[#e8e8e8] focus:border-[#fcee09]/65 focus:outline-none focus:shadow-[0_0_14px_rgba(252,238,9,0.08)]"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c7c7c]">
                    Ctrl + F
                  </span>
                </label>
              </div>

              <section className="flex min-h-0 flex-1 flex-col border border-[#232323] bg-[#101010]">
                <div className="grid grid-cols-[minmax(0,1fr)_120px] border-b border-[#1a1a1a] bg-[#151515] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#c8c3bf]">
                  <div>Name</div>
                  <div className="text-right">Scope</div>
                </div>

                <div className="border-b border-[#1a1a1a] bg-[#0d0d0d] px-4 py-3 text-sm text-[#9b9b9b]">
                  {fileTreeModeDescription}
                </div>

                <div
                  className="hyperion-scrollbar min-h-0 flex-1 overflow-y-auto"
                  onContextMenu={handleTreeBlankContextMenu}
                >
                  {filteredFileTree.length > 0 ? (
                    filteredFileTree.map((node) => (
                      <FileTreeBranch
                        key={node.id}
                        node={node}
                        depth={0}
                        expandedIds={displayedExpandedIds}
                        onToggle={toggleTreeNode}
                        selectedId={selectedNodeId}
                        onSelect={setSelectedNodeId}
                        onContextMenu={handleTreeNodeContextMenu}
                      />
                    ))
                  ) : (
                    <div className="px-5 py-14 text-center text-sm text-[#8d8d8d]">
                      No files matched this search.
                    </div>
                  )}
                </div>
              </section>

            </div>
          ) : (
            <div className="mt-5 min-h-0 flex flex-1 flex-col gap-5">
                <ConflictSection
                  conflicts={lossConflicts}
                  emptyMessage="No other mod is currently overwriting files from this mod."
                  mod={mod}
                  tone="loss"
                  title={`Other Mods Win (-${conflictSummary.overwrittenBy})`}
                  collapsed={lossConflictsCollapsed}
                  onToggleCollapsed={() => setLossConflictsCollapsed((current) => !current)}
                  className={lossConflictsCollapsed ? 'flex-none' : 'flex-1'}
                />

                <ConflictSection
                  conflicts={winConflicts}
                  emptyMessage="This mod is not currently overwriting files from other mods."
                  mod={mod}
                  tone="win"
                  title={`This Mod Wins (+${conflictSummary.overwrites})`}
                  collapsed={winConflictsCollapsed}
                  onToggleCollapsed={() => setWinConflictsCollapsed((current) => !current)}
                  className={winConflictsCollapsed ? 'flex-none' : 'flex-1'}
                />
            </div>
          )}
        </div>
      </div>

      {treeContextMenu && createPortal(
        <div
          ref={treeContextMenuRef}
          className="fixed z-[205] min-w-[228px] border border-[#222] bg-[#0a0a0a] py-1 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          style={{ left: treeContextMenu.x, top: treeContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenuNode ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void handleOpenNodeLocation(contextMenuNode, contextMenuRevealPath)
                  setTreeContextMenu(null)
                }}
                disabled={!contextMenuRevealPath}
                className={`${treeMenuButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span>{contextMenuNode.kind === 'file' ? 'Open File Location' : 'Open Exact Location'}</span>
              </button>
              <div className="my-1 border-t border-[#222]" />
              <button
                type="button"
                onClick={() => openTreeActionDialog('create-folder', contextMenuNode.id)}
                className={treeMenuButtonClass}
              >
                <span className="material-symbols-outlined text-[16px]">create_new_folder</span>
                <span>Create Folder</span>
              </button>
              <div className="my-1 border-t border-[#222]" />
              <button
                type="button"
                onClick={() => openTreeActionDialog('rename', contextMenuNode.id)}
                disabled={!contextMenuCanRename}
                className={`${treeMenuButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
                <span>Rename</span>
              </button>
              <button
                type="button"
                onClick={() => openTreeActionDialog('delete', contextMenuNode.id)}
                disabled={!contextMenuCanDelete}
                className={`${treeMenuDangerButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Delete</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setTreeContextMenu(null)
                  void handleOpenFolder()
                }}
                className={treeMenuButtonClass}
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span>Open Mod Folder</span>
              </button>
              <div className="my-1 border-t border-[#222]" />
              <button
                type="button"
                onClick={() => openTreeActionDialog('create-folder', null)}
                className={treeMenuButtonClass}
              >
                <span className="material-symbols-outlined text-[16px]">create_new_folder</span>
                <span>Create Folder</span>
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {treeActionDialog && (treeActionDialog.mode === 'create-folder' || treeActionDialog.mode === 'rename')
        ? createPortal(
          <SeparatorNameDialog
            title={
              treeActionDialog.mode === 'rename'
                ? 'Rename Entry'
                : 'Create Folder'
            }
            description={
              treeActionDialog.mode === 'rename'
                ? 'Choose the new name for this entry inside the mod package.'
                : 'Create a new folder in the currently targeted location of this mod.'
            }
            inputLabel={
              treeActionDialog.mode === 'rename'
                ? 'Entry Name'
                : 'Folder Name'
            }
            value={treeActionValue}
            submitLabel={
              treeActionDialog.mode === 'rename'
                ? 'Save Name'
                : 'Create Folder'
            }
            onChange={setTreeActionValue}
            onSubmit={() => void handleSubmitTreeAction()}
            onCancel={() => {
              if (treeActionSubmitting) return
              setTreeActionDialog(null)
              setTreeActionValue('')
            }}
            selectOnOpen={treeActionDialog.mode === 'rename'}
            submitting={treeActionSubmitting}
          />,
          document.body
        )
        : null}

      {editingName ? createPortal(
        <SeparatorNameDialog
          title="Rename Mod"
          description="Update the label shown for this mod in the library."
          inputLabel="Mod Name"
          value={nameValue}
          submitLabel={nameSaving ? 'Saving...' : 'Save Name'}
          onChange={setNameValue}
          onSubmit={() => void handleSaveName()}
          onCancel={handleCancelNameEdit}
          selectOnOpen
          submitting={nameSaving}
        />,
        document.body
      ) : null}

      {treeActionDialog?.mode === 'delete' ? (
        <ActionPromptDialog
          accentColor="#ff4d4f"
          accentGlow="rgba(255,77,79,0.45)"
          title="Delete Entry"
          description="This will permanently remove the selected file or folder from the mod package."
          detailLabel="Target"
          detailValue={findFileTreeNode(fileTree, treeActionDialog.nodeId)?.path ?? 'Unknown entry'}
          icon="delete"
          primaryLabel="Delete"
          primaryTextColor="#ffffff"
          onPrimary={() => void handleSubmitTreeAction()}
          onCancel={() => {
            if (treeActionSubmitting) return
            setTreeActionDialog(null)
          }}
          submitting={treeActionSubmitting}
        />
      ) : null}
    </div>,
    document.body
  )
}
