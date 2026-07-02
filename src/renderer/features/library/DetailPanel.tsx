import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseButton } from '@heroui/react'
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
import { useTranslation } from '../../i18n/I18nContext'
import { Tooltip } from '../ui/Tooltip'
import { ActionPromptDialog } from '../ui/ActionPromptDialog'
import { SeparatorNameDialog } from '../ui/SeparatorNameDialog'
import { isUnresolvedArchiveConflict } from '../../utils/archiveConflictDisplay'
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
import { Icon } from '../ui/Icon'
import { HyperionBadge } from '../ui/HyperionPrimitives'
import { SegmentedTabs } from '../ui/uiKit'
import {
  buildFileTree,
  collectDefaultExpandedIds,
  collectFolderIds,
  collectVisibleNodeIds,
  filterFileTree,
  findFileTreeNode,
  getCreateParentRelativePath,
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

const treeMenuButtonClass = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-primary)]'
const treeMenuDangerButtonClass = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--status-error)] transition-colors hover:bg-[rgb(248_113_113/0.1)]'

function sanitizeTreeEntryName(rawName: string): string {
  return rawName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[ ]+$/g, '')
}

function getParentTreeNodeId(nodeId: string): string | null {
  const parts = normalizeRelativePath(nodeId).split('/').filter(Boolean)
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join('/')
}

function replaceTreeNodeName(nodeId: string, nextName: string): string {
  const parts = normalizeRelativePath(nodeId).split('/').filter(Boolean)
  if (parts.length === 0) return nextName
  return [...parts.slice(0, -1), nextName].join('/')
}

function remapExpandedTreeIds(currentIds: Set<string>, previousNodeId: string, nextNodeId: string): Set<string> {
  const nextIds = new Set<string>()
  const previousPrefix = `${previousNodeId}/`

  currentIds.forEach((id) => {
    if (id === previousNodeId) {
      nextIds.add(nextNodeId)
      return
    }

    if (id.startsWith(previousPrefix)) {
      nextIds.add(`${nextNodeId}${id.slice(previousNodeId.length)}`)
      return
    }

    nextIds.add(id)
  })

  return nextIds
}

export const DetailPanel: React.FC<DetailPanelProps> = ({
  modId,
  onClose,
  initialTab = 'files',
  initialEditName = false,
}) => {
  const { t } = useTranslation()
  const {
    mods,
    conflicts,
    updateModMetadata,
    scanMods,
    addToast,
    settings,
    resolveArchiveNames,
    refreshModFiles,
  } = useAppStore((state) => ({
    mods: state.mods,
    conflicts: state.conflicts,
    updateModMetadata: state.updateModMetadata,
    scanMods: state.scanMods,
    addToast: state.addToast,
    settings: state.settings,
    resolveArchiveNames: state.resolveArchiveNames,
    refreshModFiles: state.refreshModFiles,
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
    () => mod?.files.filter((file) => file !== '_metadata.json' && file !== '_archive_resources.json') ?? [],
    [mod?.files]
  )

  const fileTreeEntries = useMemo(() => {
    if (!mod) return []

    // The Files tab is a faithful 1:1 mirror of the mod's real folder on disk — exactly
    // the files and folders you'd see in Explorer, so any rename/add/remove on disk shows
    // up verbatim. We build straight from the source paths and do NOT transform them into
    // the inferred game-deployment layout. (Hyperion's own bookkeeping files are hidden.)
    const entriesBySourcePath = new Map<string, FileTreeEntry>()

    const registerEntry = (rawPath: string, kind: 'file' | 'folder') => {
      const normalized = normalizeRelativePath(rawPath)
      if (!normalized) return
      const existing = entriesBySourcePath.get(normalized)
      if (!existing || (existing.kind === 'folder' && kind === 'file')) {
        entriesBySourcePath.set(normalized, { deployPath: normalized, kind, sourcePath: normalized })
      }
    }

    visibleFiles.forEach((file) => registerEntry(file, 'file'))
    ;(mod.emptyDirs ?? []).forEach((emptyDir) => registerEntry(emptyDir, 'folder'))

    return Array.from(entriesBySourcePath.values())
  }, [mod, visibleFiles])

  const fileTree = useMemo(
    () => buildFileTree(fileTreeEntries),
    [fileTreeEntries]
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
    () => mod ? conflicts.filter((conflict) => isIncomingConflictForMod(conflict, mod)) : [],
    [conflicts, mod]
  )

  const lossConflicts = useMemo(
    () => mod ? conflicts.filter((conflict) => conflict.existingModId === mod.uuid) : [],
    [conflicts, mod]
  )

  // Sub-tab state for conflicts: regular file conflicts vs archive-resource (.archive) conflicts
  const [conflictSubTab, setConflictSubTab] = useState<'files' | 'archives'>('files')

  const winFileConflicts = useMemo(
    () => winConflicts.filter((c) => c.kind !== 'archive-resource'),
    [winConflicts]
  )
  const winArchiveConflicts = useMemo(
    () => winConflicts.filter((c) => c.kind === 'archive-resource'),
    [winConflicts]
  )
  const lossFileConflicts = useMemo(
    () => lossConflicts.filter((c) => c.kind !== 'archive-resource'),
    [lossConflicts]
  )
  const lossArchiveConflicts = useMemo(
    () => lossConflicts.filter((c) => c.kind === 'archive-resource'),
    [lossConflicts]
  )

  const totalFileConflicts = winFileConflicts.length + lossFileConflicts.length
  const totalArchiveConflicts = winArchiveConflicts.length + lossArchiveConflicts.length

  // The conflict inspector is the only surface that shows archive-resource names. Indexing
  // resolves names from the in-memory DB only (fast); if any of this mod's archive conflicts
  // are still rendering a raw hash, resolve them lazily via the external tooling now that the
  // user is actually viewing them. The store action is guarded to run at most once per mod
  // per session, so it's safe that this effect re-runs as conflicts refresh.
  const hasUnresolvedArchiveConflict = useMemo(
    () => [...winArchiveConflicts, ...lossArchiveConflicts].some(isUnresolvedArchiveConflict),
    [winArchiveConflicts, lossArchiveConflicts]
  )
  useEffect(() => {
    if (activeTab !== 'conflicts' || !mod || !hasUnresolvedArchiveConflict) return
    void resolveArchiveNames(mod.uuid)
  // mod identity changes with the mods array; only its uuid matters here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, mod?.uuid, hasUnresolvedArchiveConflict, resolveArchiveNames])

  // Keep both subtabs visible; user prefers renaming rather than hiding.

  // When a mod's details open, re-read its files from disk so anything added or removed in
  // the mod folder via Explorer appears in the Files tab — routine scans reuse the stored
  // file list and never re-walk the folder.
  useEffect(() => {
    if (mod?.uuid) void refreshModFiles(mod.uuid)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod?.uuid])

  const modsById = useMemo(() => new Map(mods.map((m) => [m.uuid, m])), [mods])

  useEffect(() => {
    setExpandedTreeIds(new Set(collectDefaultExpandedIds(fileTree)))
  // Tree mutations rescan the same mod; preserve expansion unless the mod changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod?.uuid])

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
  const fileTreeModeDescription = t('library.detail.treeModeMirror')
  const fullscreenLikeViewport = Math.abs(viewport.screenWidth - viewport.width) <= 48
    && Math.abs(viewport.screenHeight - viewport.height) <= 72
  const detailPanelFrameStyle: React.CSSProperties = {
    height: fullscreenLikeViewport
      ? 'min(1040px, calc(100vh - 12px))'
      : 'min(980px, calc(100vh - 24px))',
    width: fullscreenLikeViewport
      ? 'min(1240px, calc(100vw - 60px))'
      : 'min(1480px, calc(100vw - 48px))',
    maxWidth: fullscreenLikeViewport ? '1240px' : 'calc(100vw - 48px)',
  }
  const contextMenuNode = findFileTreeNode(fileTree, treeContextMenu?.nodeId ?? null)
  const contextMenuExistingRelativePath = getExistingNodeRelativePath(contextMenuNode)
  const contextMenuCreateParentRelativePath = getCreateParentRelativePath(contextMenuNode)
  const contextMenuRevealPath = contextMenuNode
    ? (
      contextMenuExistingRelativePath && modFolderPath
        ? joinWindowsPath(modFolderPath, contextMenuExistingRelativePath)
        : null
    )
    : modFolderPath
  const contextMenuCanCreateFolder = !contextMenuNode || contextMenuCreateParentRelativePath !== null
  const contextMenuCanRename = Boolean(contextMenuNode && contextMenuExistingRelativePath)
  const contextMenuCanDelete = Boolean(contextMenuNode && contextMenuExistingRelativePath)

  const handleSaveName = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed) {
      addToast(t('library.detail.toastNameEmpty'), 'warning')
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
    addToast(t('library.detail.toastNameUpdated'), 'success', 1800)
  }

  const handleCancelNameEdit = () => {
    setNameValue(mod.name)
    setEditingName(false)
  }

  const handleOpenFolder = async () => {
    if (!modFolderPath) {
      addToast(t('library.detail.toastLibraryPathNotConfigured'), 'warning')
      return
    }

    await IpcService.invoke(IPC.OPEN_PATH, modFolderPath)
  }

  const handleOpenNodeLocation = async (node: FileTreeNode | null, revealPath: string | null) => {
    if (!node || !revealPath) {
      addToast(t('library.detail.toastSelectFirst'), 'warning')
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
    let successMessage = t('library.detail.toastTreeUpdated')

    if (treeActionDialog.mode === 'create-folder') {
      const parentRelativePath = getCreateParentRelativePath(targetNode)
      if (parentRelativePath === null) {
        setTreeActionSubmitting(false)
        addToast(t('library.detail.toastNoExactSource'), 'warning')
        return
      }

      const request: ModTreeCreateEntryRequest = {
        modId: mod.uuid,
        kind: 'folder',
        name: treeActionValue,
        parentRelativePath,
      }
      result = await IpcService.invoke<IpcResult<ModMetadata>>(IPC.MOD_TREE_CREATE_ENTRY, request)
      successMessage = t('library.detail.toastFolderCreated')
    } else if (treeActionDialog.mode === 'rename') {
      const relativePath = getExistingNodeRelativePath(targetNode)
      if (!relativePath) {
        setTreeActionSubmitting(false)
        addToast(t('library.detail.toastCannotRename'), 'warning')
        return
      }

      const request: ModTreeRenameEntryRequest = {
        modId: mod.uuid,
        relativePath,
        nextName: treeActionValue,
      }
      result = await IpcService.invoke<IpcResult<ModMetadata>>(IPC.MOD_TREE_RENAME_ENTRY, request)
      successMessage = t('library.detail.toastEntryRenamed')
    } else {
      const relativePath = getExistingNodeRelativePath(targetNode)
      if (!relativePath) {
        setTreeActionSubmitting(false)
        addToast(t('library.detail.toastCannotDelete'), 'warning')
        return
      }

      const request: ModTreeDeleteEntryRequest = {
        modId: mod.uuid,
        relativePath,
      }
      result = await IpcService.invoke<IpcResult<ModMetadata>>(IPC.MOD_TREE_DELETE_ENTRY, request)
      successMessage = t('library.detail.toastEntryDeleted')
    }

    setTreeActionSubmitting(false)

    if (!result.ok) {
      addToast(result.error ?? t('library.detail.toastTreeActionFailed'), 'error')
      return
    }

    let nextSelectedNodeId: string | null = null

    if (treeActionDialog.mode === 'create-folder') {
      const nodeToKeepOpen = targetNode?.kind === 'folder'
        ? targetNode.id
        : targetNode
          ? getParentTreeNodeId(targetNode.id)
          : null

      if (nodeToKeepOpen) {
        setExpandedTreeIds((current) => new Set(current).add(nodeToKeepOpen))
      }
    } else if (treeActionDialog.mode === 'rename' && targetNode?.kind === 'folder') {
      const nextName = sanitizeTreeEntryName(treeActionValue)
      if (nextName) {
        const nextNodeId = replaceTreeNodeName(targetNode.id, nextName)
        setExpandedTreeIds((current) => remapExpandedTreeIds(current, targetNode.id, nextNodeId))
        nextSelectedNodeId = nextNodeId
      }
    } else if (treeActionDialog.mode === 'rename' && targetNode) {
      const nextName = sanitizeTreeEntryName(treeActionValue)
      nextSelectedNodeId = nextName ? replaceTreeNodeName(targetNode.id, nextName) : null
    }

    // Refresh ONLY the edited mod so the Files tree updates instantly — re-scanning
    // the whole library here (and recomputing every mod's conflicts) is what made
    // each create/rename/delete feel slow. A full sync still runs in the background,
    // unawaited, to keep conflict badges current without blocking the action.
    await refreshModFiles(mod.uuid)
    setTreeActionDialog(null)
    setTreeActionValue('')
    setSelectedNodeId(nextSelectedNodeId)
    addToast(successMessage, 'success', 1800)
    void scanMods()
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[160] flex items-center justify-center bg-[rgba(0,0,0,0.86)] px-6 backdrop-blur-[3px] fade-in ${
        fullscreenLikeViewport ? 'py-1.5' : 'py-3'
      }`}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
        style={detailPanelFrameStyle}
        onClick={(event) => event.stopPropagation()}
      >

        <div className="relative flex min-h-0 flex-1 flex-col px-8 pb-7 pt-7">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-3">
                <h2 className={`min-w-0 flex-1 whitespace-normal break-words ${detailTitleClass}`}>
                  {mod.name}
                </h2>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3 self-start">
              <HyperionBadge tone={mod.enabled ? 'success' : 'neutral'}>
                {mod.enabled ? t('library.detail.enabled') : t('library.detail.disabled')}
              </HyperionBadge>

              <Tooltip content={t('library.detail.renameMod')}>
                <button
                  onClick={() => {
                    setNameValue(mod.name)
                    setEditingName(true)
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border-0 bg-[var(--surface)] text-[var(--text-support)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
                >
                  <Icon name="edit" className="text-[18px]" />
                </button>
              </Tooltip>

              <Tooltip content={t('library.detail.closeDetails')}>
                <CloseButton
                  aria-label={t('library.detail.closeDetails')}
                  onPress={onClose}
                  className="h-10 w-10 shrink-0 rounded-lg bg-[var(--surface)] text-[var(--text-support)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
                />
              </Tooltip>
            </div>
          </div>

          <div role="tablist" className="mt-5 flex items-end gap-1 border-b border-[var(--border)]">
            <TabButton active={activeTab === 'files'} label={t('library.detail.tabFiles')} onClick={() => setActiveTab('files')} />
            <TabButton active={activeTab === 'conflicts'} label={t('library.detail.tabConflicts')} onClick={() => setActiveTab('conflicts')} />
          </div>

          {activeTab === 'files' ? (
            <div className="mt-5 flex min-h-0 flex-1 flex-col gap-4">
              <div className="grid gap-3 xl:grid-cols-[auto_minmax(0,1fr)]">
                <button
                  type="button"
                  onClick={() => void handleOpenFolder()}
                  className={detailToolbarButtonClass}
                >
                  <Icon name="folder_open" className="text-[16px]" />
                  <span>{t('library.detail.openModFolder')}</span>
                </button>

                <label className="group relative min-w-[300px] flex-1">
                  <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[var(--text-muted)] transition-colors group-focus-within:text-[var(--accent)]" />
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('library.detail.searchFiles')}
                    className="h-10 w-full rounded-lg border-0 bg-[var(--surface)] py-1.5 pl-10 pr-[88px] text-sm text-[var(--text-primary-alt)] placeholder-[var(--text-muted)] transition-colors hover:bg-[var(--surface-secondary)] focus:bg-[var(--surface-secondary)] focus:outline-none focus:shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/0.4)]"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    Ctrl + F
                  </span>
                </label>
              </div>

              <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="grid grid-cols-[minmax(0,1fr)_120px] border-b border-[var(--border)] bg-[var(--surface-secondary)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  <div>{t('library.detail.columnName')}</div>
                  <div className="text-right">{t('library.detail.columnScope')}</div>
                </div>

                <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-support)]">
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
                      {t('library.detail.noFilesMatched')}
                    </div>
                  )}
                </div>
              </section>

            </div>
          ) : (
            <div className="mt-5 min-h-0 flex flex-1 flex-col gap-5">
              <SegmentedTabs
                items={[
                  { id: 'files' as const, label: t('library.detail.pathsTab', { count: totalFileConflicts }) },
                  { id: 'archives' as const, label: t('library.detail.archivesTab', { count: totalArchiveConflicts }) },
                ]}
                activeId={conflictSubTab}
                onChange={setConflictSubTab}
                ariaLabel={t('library.detail.tabConflicts')}
              />

              <div className="mt-3 min-h-0 flex flex-1 flex-col gap-5">
                <ConflictSection
                  conflicts={conflictSubTab === 'files' ? winFileConflicts : winArchiveConflicts}
                  emptyMessage={t('library.detail.winsEmpty')}
                  mod={mod}
                  tone="win"
                  title={t('library.detail.winsTitle')}
                  collapsed={winConflictsCollapsed}
                  onToggleCollapsed={() => setWinConflictsCollapsed((current) => !current)}
                  className={winConflictsCollapsed ? 'flex-none' : 'flex-1'}
                  showArchiveDetails={conflictSubTab === 'archives'}
                  modsById={modsById}
                />

                <ConflictSection
                  conflicts={conflictSubTab === 'files' ? lossFileConflicts : lossArchiveConflicts}
                  emptyMessage={t('library.detail.lossEmpty')}
                  mod={mod}
                  tone="loss"
                  title={t('library.detail.lossTitle')}
                  collapsed={lossConflictsCollapsed}
                  onToggleCollapsed={() => setLossConflictsCollapsed((current) => !current)}
                  className={lossConflictsCollapsed ? 'flex-none' : 'flex-1'}
                  showArchiveDetails={conflictSubTab === 'archives'}
                  modsById={modsById}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {treeContextMenu && createPortal(
        <div
          ref={treeContextMenuRef}
          className="fixed z-[205] min-w-[228px] rounded-xl border border-[var(--border)] bg-[var(--overlay)] p-1.5 shadow-[0_16px_44px_rgba(0,0,0,0.55)]"
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
                <Icon name="folder_open" className="text-[16px]" />
                <span>{contextMenuNode.kind === 'file' ? t('library.detail.menuOpenFileLocation') : t('library.detail.menuOpenExactLocation')}</span>
              </button>
              <div className="my-1 border-t border-[var(--border)]" />
              <button
                type="button"
                onClick={() => openTreeActionDialog('create-folder', contextMenuNode.id)}
                disabled={!contextMenuCanCreateFolder}
                className={`${treeMenuButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Icon name="create_new_folder" className="text-[16px]" />
                <span>{t('library.detail.menuCreateFolder')}</span>
              </button>
              <div className="my-1 border-t border-[var(--border)]" />
              <button
                type="button"
                onClick={() => openTreeActionDialog('rename', contextMenuNode.id)}
                disabled={!contextMenuCanRename}
                className={`${treeMenuButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Icon name="edit" className="text-[16px]" />
                <span>{t('library.detail.menuRename')}</span>
              </button>
              <button
                type="button"
                onClick={() => openTreeActionDialog('delete', contextMenuNode.id)}
                disabled={!contextMenuCanDelete}
                className={`${treeMenuDangerButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Icon name="delete" className="text-[16px]" />
                <span>{t('common.delete')}</span>
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
                <Icon name="folder_open" className="text-[16px]" />
                <span>{t('library.detail.openModFolder')}</span>
              </button>
              <div className="my-1 border-t border-[var(--border)]" />
              <button
                type="button"
                onClick={() => openTreeActionDialog('create-folder', null)}
                className={treeMenuButtonClass}
              >
                <Icon name="create_new_folder" className="text-[16px]" />
                <span>{t('library.detail.menuCreateFolder')}</span>
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
                ? t('library.detail.dialogRenameEntryTitle')
                : t('library.detail.dialogCreateFolderTitle')
            }
            description={
              treeActionDialog.mode === 'rename'
                ? t('library.detail.dialogRenameEntryDescription')
                : t('library.detail.dialogCreateFolderDescription')
            }
            inputLabel={
              treeActionDialog.mode === 'rename'
                ? t('library.detail.dialogEntryNameLabel')
                : t('library.detail.dialogFolderNameLabel')
            }
            value={treeActionValue}
            submitLabel={
              treeActionDialog.mode === 'rename'
                ? t('library.detail.dialogSaveName')
                : t('library.detail.dialogCreateFolderTitle')
            }
            onChange={setTreeActionValue}
            onSubmit={() => void handleSubmitTreeAction()}
            onCancel={() => {
              if (treeActionSubmitting) return
              setTreeActionDialog(null)
              setTreeActionValue('')
            }}
            submitting={treeActionSubmitting}
          />,
          document.body
        )
        : null}

      {editingName ? createPortal(
        <SeparatorNameDialog
          title={t('library.detail.dialogRenameModTitle')}
          description={t('library.detail.dialogRenameModDescription')}
          inputLabel={t('library.detail.dialogModNameLabel')}
          value={nameValue}
          submitLabel={nameSaving ? t('library.detail.dialogSaving') : t('library.detail.dialogSaveName')}
          onChange={setNameValue}
          onSubmit={() => void handleSaveName()}
          onCancel={handleCancelNameEdit}
          submitting={nameSaving}
        />,
        document.body
      ) : null}

      {treeActionDialog?.mode === 'delete' ? (
        <ActionPromptDialog
          tone="danger"
          title={t('library.detail.dialogDeleteEntryTitle')}
          description={t('library.detail.dialogDeleteEntryDescription')}
          detailLabel={t('library.detail.dialogDeleteEntryTarget')}
          detailValue={findFileTreeNode(fileTree, treeActionDialog.nodeId)?.path ?? t('library.detail.dialogUnknownEntry')}
          icon="delete"
          primaryLabel={t('common.delete')}
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
