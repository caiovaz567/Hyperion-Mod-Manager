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
import { formatWindowsDateTimeOrFallback } from '../../utils/dateFormat'

interface DetailPanelProps {
  modId: string
  onClose: () => void
  onDeleteRequest: (mod: ModMetadata) => void
  initialTab?: 'files' | 'conflicts'
  initialEditName?: boolean
}

type DetailTab = 'files' | 'conflicts'

type TreeContextMenuState = {
  x: number
  y: number
  nodeId: string | null
}

type TreeActionDialogState =
  | { mode: 'create-folder' | 'rename'; nodeId: string | null }
  | { mode: 'delete'; nodeId: string }

const TYPE_LABEL: Record<string, string> = {
  archive: 'Archive',
  redmod: 'REDmod',
  cet: 'CET',
  redscript: 'Redscript',
  tweakxl: 'TweakXL',
  red4ext: 'RED4ext',
  bin: 'Binary',
  engine: 'Engine',
  r6: 'R6',
  unknown: 'Unknown',
}

const GAME_ROOT_DIRS = new Set(['archive', 'bin', 'engine', 'mods', 'r6', 'red4ext'])
const ARCHIVE_EXTENSIONS = new Set(['.archive', '.xl'])

interface FileTreeEntry {
  deployPath: string
  kind: 'file' | 'folder'
  sourcePath?: string
}

interface FileTreeNode {
  id: string
  name: string
  path: string
  kind: 'folder' | 'file'
  sourcePath?: string
  fileCount: number
  children: FileTreeNode[]
}

interface DetailViewport {
  width: number
  height: number
  screenWidth: number
  screenHeight: number
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

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return 'Unknown'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function normalizeRelativePath(relPath: string): string {
  return relPath
    .split(/[\\/]+/)
    .filter((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
    .join('/')
}

function joinRelativePath(...segments: string[]): string {
  return normalizeRelativePath(segments.join('/'))
}

function joinWindowsPath(basePath: string, relPath?: string): string {
  const sanitizedBase = basePath.replace(/[\\/]+$/, '')
  if (!relPath?.trim()) return sanitizedBase
  return `${sanitizedBase}\\${relPath.split('/').join('\\')}`
}

function getParentRelativePath(relPath?: string): string {
  const parts = splitPathSegments(relPath ?? '')
  return parts.slice(0, -1).join('/')
}

function splitPathSegments(relPath: string): string[] {
  const normalized = normalizeRelativePath(relPath)
  return normalized ? normalized.split('/').filter(Boolean) : []
}

function getModFolderKey(mod: ModMetadata): string {
  const folderName = mod.folderName?.trim()
  if (folderName) return folderName
  return mod.uuid
}

function findSequenceIndex(parts: string[], sequence: string[]): number {
  const lowerParts = parts.map((part) => part.toLowerCase())
  const lowerSequence = sequence.map((segment) => segment.toLowerCase())

  for (let index = 0; index <= lowerParts.length - lowerSequence.length; index += 1) {
    if (lowerSequence.every((segment, offset) => lowerParts[index + offset] === segment)) {
      return index
    }
  }

  return -1
}

function isRedmodContent(mod: ModMetadata, relFile: string): boolean {
  const modFolderKey = getModFolderKey(mod)
  const normalized = normalizeRelativePath(relFile)
  const lowerNormalized = normalized.toLowerCase()

  return (
    mod.type === 'redmod' ||
    lowerNormalized === 'info.json' ||
    lowerNormalized.startsWith('archives/') ||
    lowerNormalized.startsWith(`${modFolderKey.toLowerCase()}/archives/`)
  )
}

function hasKnownGameRootPrefix(parts: string[]): boolean {
  const first = parts[0]?.toLowerCase()
  return Boolean(first) && GAME_ROOT_DIRS.has(first)
}

function inferLegacyRedscriptRootPath(normalized: string, parts: string[]): string | null {
  const first = parts[0]?.toLowerCase()
  const second = parts[1]?.toLowerCase()

  if (!first) return null

  if (first === 'tools') {
    return joinRelativePath('engine', normalized)
  }

  if (first === 'config' && (second === 'base' || second === 'platform')) {
    return joinRelativePath('engine', normalized)
  }

  if (
    first === 'scripts' ||
    first === 'tweaks' ||
    first === 'cache' ||
    (first === 'config' && second === 'cybercmd')
  ) {
    return joinRelativePath('r6', normalized)
  }

  return null
}

function inferLegacyFlattenedDeployPath(mod: ModMetadata, normalized: string, parts: string[]): string | null {
  if (!normalized || hasKnownGameRootPrefix(parts)) return null

  const modFolderKey = getModFolderKey(mod)

  switch (mod.type) {
    case 'engine':
      return joinRelativePath('engine', normalized)
    case 'r6':
      return joinRelativePath('r6', normalized)
    case 'redscript':
      return inferLegacyRedscriptRootPath(normalized, parts)
    case 'red4ext':
      return joinRelativePath('red4ext', normalized)
    case 'bin':
      return parts[0]?.toLowerCase() === 'x64'
        ? joinRelativePath('bin', normalized)
        : joinRelativePath('bin', 'x64', normalized)
    case 'cet':
      return joinRelativePath('bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'mods', modFolderKey, normalized)
    default:
      return null
  }
}

function getDeployRelativePath(mod: ModMetadata, relFile: string): string {
  const normalized = normalizeRelativePath(relFile)
  const parts = splitPathSegments(normalized)
  const modFolderKey = getModFolderKey(mod)
  const fileName = parts[parts.length - 1] ?? normalized
  const extensionMatch = /\.([^.]+)$/.exec(normalized)
  const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : ''

  const binX64Index = findSequenceIndex(parts, ['bin', 'x64'])
  if (binX64Index >= 0) {
    return joinRelativePath(...parts.slice(binX64Index))
  }

  const cetIndex = findSequenceIndex(parts, ['cyber_engine_tweaks', 'mods'])
  if (cetIndex >= 0) {
    return joinRelativePath('bin', 'x64', 'plugins', ...parts.slice(cetIndex))
  }

  const legacyFlattenedPath = inferLegacyFlattenedDeployPath(mod, normalized, parts)
  if (legacyFlattenedPath) {
    return legacyFlattenedPath
  }

  const pluginsIndex = findSequenceIndex(parts, ['plugins'])
  if (pluginsIndex >= 0) {
    const priorSegment = parts[pluginsIndex - 1]?.toLowerCase()
    if (priorSegment === 'red4ext') {
      return joinRelativePath(...parts.slice(pluginsIndex - 1))
    }
    return joinRelativePath('bin', 'x64', ...parts.slice(pluginsIndex))
  }

  const gameRootIndex = parts.findIndex((segment) => GAME_ROOT_DIRS.has(segment.toLowerCase()))
  if (gameRootIndex >= 0) {
    return joinRelativePath(...parts.slice(gameRootIndex))
  }

  if (isRedmodContent(mod, normalized)) {
    return joinRelativePath('mods', modFolderKey, normalized)
  }

  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return joinRelativePath('archive', 'pc', 'mod', fileName)
  }

  if (extension === '.reds') {
    return joinRelativePath('r6', 'scripts', normalized)
  }

  if (extension === '.yaml' || extension === '.yml') {
    return joinRelativePath('r6', 'tweaks', normalized)
  }

  if (extension === '.lua') {
    return joinRelativePath('bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'mods', modFolderKey, normalized)
  }

  if (extension === '.asi') {
    return joinRelativePath('bin', 'x64', 'plugins', fileName)
  }

  if (extension === '.dll') {
    if (mod.type === 'red4ext') {
      return joinRelativePath('red4ext', 'plugins', modFolderKey, normalized)
    }
    return joinRelativePath('bin', 'x64', normalized)
  }

  return normalized
}

function getDeployRelativeFolderPath(mod: ModMetadata, relFolder: string): string {
  const normalized = normalizeRelativePath(relFolder)
  if (!normalized) return ''
  return getParentRelativePath(getDeployRelativePath(mod, joinRelativePath(normalized, '__hyperion_empty__.keep')))
}

function buildFileTree(entries: FileTreeEntry[]): FileTreeNode[] {
  type MutableTreeNode = {
    id: string
    name: string
    path: string
    kind: 'folder' | 'file'
    sourcePath?: string
    fileCount: number
    children: Map<string, MutableTreeNode>
  }

  const root: MutableTreeNode = {
    id: 'root',
    name: 'root',
    path: '',
    kind: 'folder',
    fileCount: 0,
    children: new Map(),
  }

  const folderSourcePaths = new Map<string, string>()

  for (const entry of entries) {
    if (!entry.sourcePath?.trim()) continue

    if (entry.kind === 'folder') {
      folderSourcePaths.set(normalizeRelativePath(entry.deployPath), normalizeRelativePath(entry.sourcePath))
      continue
    }

    const deployFolderParts = splitPathSegments(getParentRelativePath(entry.deployPath))
    const sourceFolderParts = splitPathSegments(getParentRelativePath(entry.sourcePath))
    if (deployFolderParts.length === 0 || sourceFolderParts.length === 0) continue

    const prefixOffset = Math.max(0, deployFolderParts.length - sourceFolderParts.length)
    for (let index = 0; index < sourceFolderParts.length; index += 1) {
      const deployFolderPath = deployFolderParts.slice(0, prefixOffset + index + 1).join('/')
      const sourceFolderPath = sourceFolderParts.slice(0, index + 1).join('/')
      if (!deployFolderPath || !sourceFolderPath || folderSourcePaths.has(deployFolderPath)) continue
      folderSourcePaths.set(deployFolderPath, sourceFolderPath)
    }
  }

  for (const entry of entries) {
    const normalized = normalizeRelativePath(entry.deployPath)
    if (!normalized) continue

    const parts = normalized.split('/')
    let currentNode = root
    if (entry.kind === 'file') {
      root.fileCount += 1
    }

    parts.forEach((segment, index) => {
      const nextPath = currentNode.path ? `${currentNode.path}/${segment}` : segment
      const nextKind = index === parts.length - 1 ? entry.kind : 'folder'
      const existingNode = currentNode.children.get(segment)

      if (existingNode) {
        if (entry.kind === 'file') {
          existingNode.fileCount += 1
        }
        if (existingNode.kind === 'file' && nextKind === 'folder') {
          existingNode.kind = 'folder'
        }
        if (nextKind === 'file') {
          existingNode.sourcePath = entry.sourcePath
        } else if (!existingNode.sourcePath && folderSourcePaths.has(nextPath)) {
          existingNode.sourcePath = folderSourcePaths.get(nextPath)
        }
        currentNode = existingNode
        return
      }

      const nextNode: MutableTreeNode = {
        id: nextPath,
        name: segment,
        path: nextPath,
        kind: nextKind,
        sourcePath: nextKind === 'file'
          ? entry.sourcePath
          : folderSourcePaths.get(nextPath),
        fileCount: entry.kind === 'file' ? 1 : 0,
        children: new Map(),
      }

      currentNode.children.set(segment, nextNode)
      currentNode = nextNode
    })
  }

  const serializeNode = (node: MutableTreeNode): FileTreeNode => ({
    id: node.id,
    name: node.name,
    path: node.path,
    kind: node.kind,
    sourcePath: node.sourcePath,
    fileCount: node.fileCount,
    children: Array.from(node.children.values())
      .map(serializeNode)
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })
      }),
  })

  return Array.from(root.children.values())
    .map(serializeNode)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })
    })
}

function collectDefaultExpandedIds(nodes: FileTreeNode[]): Set<string> {
  void nodes
  return new Set<string>()
}

function collectFolderIds(nodes: FileTreeNode[]): Set<string> {
  const ids = new Set<string>()

  const visit = (node: FileTreeNode) => {
    if (node.kind !== 'folder') return
    ids.add(node.id)
    node.children.forEach(visit)
  }

  nodes.forEach(visit)
  return ids
}

function filterFileTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return nodes

  return nodes.flatMap((node) => {
    const matchesSelf = node.name.toLowerCase().includes(normalizedQuery) || node.path.toLowerCase().includes(normalizedQuery)

    if (node.kind === 'file') {
      return matchesSelf ? [node] : []
    }

    if (matchesSelf) {
      return [node]
    }

    const filteredChildren = filterFileTree(node.children, normalizedQuery)
    if (filteredChildren.length === 0) return []

    return [{
      ...node,
      children: filteredChildren,
    }]
  })
}

function findFileTreeNode(nodes: FileTreeNode[], nodeId: string | null): FileTreeNode | null {
  if (!nodeId) return null

  for (const node of nodes) {
    if (node.id === nodeId) return node
    const childMatch = findFileTreeNode(node.children, nodeId)
    if (childMatch) return childMatch
  }

  return null
}

function collectVisibleNodeIds(nodes: FileTreeNode[]): Set<string> {
  const ids = new Set<string>()

  const visit = (node: FileTreeNode) => {
    ids.add(node.id)
    node.children.forEach(visit)
  }

  nodes.forEach(visit)
  return ids
}

function getExistingNodeRelativePath(node: FileTreeNode | null): string | null {
  if (!node) return null
  if (node.kind === 'folder') return node.sourcePath ?? null
  return node.sourcePath ?? node.path
}

function getCreateParentRelativePath(node: FileTreeNode | null): string {
  if (!node) return ''
  if (node.kind === 'folder') return node.sourcePath ?? node.path
  return getParentRelativePath(node.sourcePath ?? node.path)
}

function buildFallbackDescription(mod: ModMetadata, fileCount: number): string {
  const typeLabel = TYPE_LABEL[mod.type] ?? TYPE_LABEL.unknown
  const sourceLabel = mod.sourceType === 'directory'
    ? 'directory import'
    : mod.sourceType === 'archive'
      ? 'archive import'
      : 'managed source'

  return `${mod.name} is stored in the Hyperion library as a ${typeLabel.toLowerCase()} package. This entry currently tracks ${fileCount} indexed file${fileCount === 1 ? '' : 's'} and keeps source metadata for reinstall, auditing, and future media cache enrichment from ${sourceLabel}.`
}

const MetaRow: React.FC<{ icon: string; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="grid grid-cols-[32px_210px_minmax(0,1fr)] items-center gap-4 border-b border-[#171717] py-4 last:border-b-0">
    <span className="material-symbols-outlined text-[20px] text-[#fcee09]">{icon}</span>
    <div className="text-sm text-[#d9d5d1]">{label}</div>
    <div className="min-w-0 break-words text-sm text-[#f1eeea]">{value}</div>
  </div>
)

const FooterActionButton: React.FC<{
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'primary' | 'secondary' | 'danger'
}> = ({
  icon,
  label,
  onClick,
  disabled = false,
  tone = 'secondary',
}) => {
  const className = disabled
    ? 'cursor-not-allowed border-[#1b1b1b] bg-[#0b0b0b] text-[#5d5d5d]'
    : tone === 'primary'
      ? 'border-[#564f11] bg-[#fcee09] text-[#050505] hover:bg-[#fff38f]'
      : tone === 'danger'
        ? 'border-[#5b1f1f] bg-[#100707] text-[#ff7f7f] hover:border-[#f87171] hover:bg-[#170808] hover:text-[#ffd2d2]'
        : 'border-[#333] bg-[#121212] text-[#efebe8] hover:border-[#4a4a4a] hover:bg-[#171717]'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[50px] items-center justify-center gap-3 border px-4 text-[11px] font-semibold uppercase tracking-[0.16em] transition-all ${className}`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

const SideCard: React.FC<{
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}> = ({ title, action, children }) => (
  <section className="border border-[#232323] bg-[#101010] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.015)]">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="brand-font text-[0.95rem] font-bold uppercase tracking-[0.08em] text-[#f4f1ee]">
        {title}
      </h3>
      {action}
    </div>
    {children}
  </section>
)

const treeMenuButtonClass = 'flex w-full items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#e5e2e1] transition-colors hover:bg-[#111] hover:text-[#fcee09]'
const treeMenuDangerButtonClass = 'flex w-full items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ffb4ab] transition-colors hover:bg-[#93000a]/10'
const detailTitleClass = 'text-[1.12rem] font-bold leading-[1.08] tracking-[0.01em] text-[#f4f1ee] sm:text-[1.18rem]'
const detailToolbarButtonClass = 'group flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border-[0.5px] border-[#fcee09]/50 bg-[#0a0a0a] px-4 text-[10px] brand-font font-bold uppercase tracking-widest text-[#cccccc] transition-colors hover:bg-[#fcee09] hover:text-[#050505] [&_.material-symbols-outlined]:!text-[#fcee09] [&_.material-symbols-outlined]:transition-colors hover:[&_.material-symbols-outlined]:!text-[#050505]'

const TabButton: React.FC<{
  active: boolean
  label: string
  onClick: () => void
}> = ({ active, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative px-2 pb-3 pt-1 text-[0.88rem] font-semibold uppercase tracking-[0.14em] transition-colors ${
      active
        ? 'text-[#f5f1ee]'
        : 'text-[#848484] hover:text-[#efebe8]'
    }`}
  >
    {label}
    {active ? (
      <span className="absolute inset-x-0 bottom-0 h-px bg-[#fcee09] shadow-[0_0_10px_rgba(252,238,9,0.28)]" />
    ) : null}
  </button>
)

const ConflictSection: React.FC<{
  conflicts: ConflictInfo[]
  emptyMessage: string
  mod: ModMetadata
  tone: 'win' | 'loss'
  title: string
  collapsed: boolean
  onToggleCollapsed: () => void
  className?: string
}> = ({ conflicts, emptyMessage, mod, tone, title, collapsed, onToggleCollapsed, className }) => (
  <section className={`flex min-h-0 flex-col border border-[#232323] bg-[#101010] ${className ?? ''}`}>
    <button
      type="button"
      onClick={onToggleCollapsed}
      className={`flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[#141414] ${
        collapsed ? '' : 'border-b border-[#1a1a1a]'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span className={`material-symbols-outlined text-[18px] text-[#8d8d8d] transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`}>
            expand_more
          </span>
          <h3 className="brand-font text-[0.95rem] font-bold uppercase tracking-[0.08em] text-[#f4f1ee]">
            {title}
          </h3>
        </div>
        <div className="mt-1 pl-8 text-sm text-[#8f8f8f]">
          {tone === 'win'
            ? 'Arquivos em que este mod vence a ordem de conflito.'
            : 'Arquivos em que outro mod vence este mod.'}
        </div>
      </div>
      <span className={`shrink-0 rounded-sm border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
        tone === 'win'
          ? 'border-[#1f5133] bg-[rgba(52,211,153,0.1)] text-[#34d399]'
          : 'border-[#5a2020] bg-[rgba(248,113,113,0.1)] text-[#f87171]'
      }`}>
        {conflicts.length} file{conflicts.length === 1 ? '' : 's'}
      </span>
    </button>

    {!collapsed && (conflicts.length > 0 ? (
      <div className="hyperion-scrollbar min-h-0 flex-1 overflow-y-auto">
        {conflicts.map((conflict, index) => {
          const otherModName = tone === 'win' ? conflict.existingModName : conflict.incomingModName
          const otherOrder = tone === 'win' ? conflict.existingOrder : conflict.incomingOrder
          const toneChipClass = conflict.kind === 'archive-resource'
            ? 'border-[#5a2020] bg-[#120808] text-[#f3b8b8]'
            : tone === 'win'
              ? 'border-[#1d3d2e] bg-[#091410] text-[#34d399]'
              : 'border-[#5a2020] bg-[#140909] text-[#f87171]'

          return (
            <div
              key={`${conflict.kind}:${conflict.resourcePath}:${conflict.existingModId}:${conflict.incomingModId ?? index}`}
              className="grid gap-4 border-b border-[#161616] px-5 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_220px]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${toneChipClass}`}>
                    {conflict.kind === 'archive-resource' ? 'Archive' : tone === 'win' ? '+ Win' : '- Loss'}
                  </span>
                  <span className="text-xs uppercase tracking-[0.14em] text-[#7f7f7f]">
                    {tone === 'win' ? mod.name : otherModName}
                  </span>
                </div>
                <div className="mt-3 break-all font-mono text-[13px] text-[#f1eeea]">
                  {conflict.resourcePath}
                </div>
              </div>

              <div className="min-w-0 border-t border-[#1a1a1a] pt-3 md:border-l md:border-[#1a1a1a] md:border-t-0 md:pl-4 md:pt-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8f8f8f]">
                  Other Mod
                </div>
                <div className="mt-2 truncate text-sm text-[#f1eeea]">
                  {otherModName}
                </div>
                {typeof otherOrder === 'number' ? (
                  <div className="mt-1 text-xs text-[#8f8f8f]">
                    Position #{otherOrder + 1}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    ) : (
      <div className="flex min-h-0 flex-1 items-center px-5 py-10 text-sm text-[#8d8d8d]">
        {emptyMessage}
      </div>
    ))}
  </section>
)

const FileTreeBranch: React.FC<{
  node: FileTreeNode
  depth: number
  expandedIds: Set<string>
  onToggle: (id: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  onContextMenu: (event: React.MouseEvent, node: FileTreeNode) => void
}> = ({ node, depth, expandedIds, onToggle, selectedId, onSelect, onContextMenu }) => {
  const isFolder = node.kind === 'folder'
  const isExpanded = isFolder && expandedIds.has(node.id)
  const selected = selectedId === node.id
  const indent = 12 + depth * 18

  return (
    <div>
      <div
        className={`flex items-center border-b border-[#171717] pr-3 transition-colors ${
          selected ? 'bg-[#191808]' : 'hover:bg-[#141414]'
        }`}
        style={{ paddingLeft: `${indent}px` }}
        onContextMenu={(event) => onContextMenu(event, node)}
      >
        {isFolder ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggle(node.id)
            }}
            className="flex h-9 w-7 shrink-0 items-center justify-center text-[#8a8a8a] transition-colors hover:text-white"
          >
            <span className={`material-symbols-outlined text-[16px] transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
              expand_more
            </span>
          </button>
        ) : (
          <span className="block h-9 w-7 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onSelect(node.id)}
          onDoubleClick={() => {
            if (isFolder) onToggle(node.id)
          }}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
        >
          <span className={`material-symbols-outlined text-[17px] ${isFolder ? 'text-[#fcee09]' : 'text-[#cfcfcf]'}`}>
            {isFolder ? 'folder' : 'description'}
          </span>
          <span className={`min-w-0 truncate text-sm ${selected ? 'text-[#fff6b8]' : 'text-[#f0ece8]'}`}>
            {node.name}
          </span>
        </button>

        <span className={`shrink-0 pl-4 text-sm ${selected ? 'text-[#f5efc4]' : 'text-[#979797]'}`}>
          {isFolder ? `${node.fileCount} file${node.fileCount === 1 ? '' : 's'}` : 'file'}
        </span>
      </div>

      {isExpanded ? (
        <div>
          {node.children.map((child) => (
            <FileTreeBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export const DetailPanel: React.FC<DetailPanelProps> = ({
  modId,
  onClose,
  onDeleteRequest,
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
    enableMod,
    disableMod,
    openReinstallPrompt,
  } = useAppStore((state) => ({
    mods: state.mods,
    conflicts: state.conflicts,
    updateModMetadata: state.updateModMetadata,
    scanMods: state.scanMods,
    addToast: state.addToast,
    settings: state.settings,
    enableMod: state.enableMod,
    disableMod: state.disableMod,
    openReinstallPrompt: state.openReinstallPrompt,
  }), shallow)

  const mod = mods.find((item) => item.uuid === modId)
  const resolvedInitialTab: DetailTab = initialTab === 'conflicts' ? 'conflicts' : 'files'
  const [activeTab, setActiveTab] = useState<DetailTab>(resolvedInitialTab)
  const [editingName, setEditingName] = useState(initialEditName)
  const [nameValue, setNameValue] = useState(mod?.name ?? '')
  const [nameSaving, setNameSaving] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState(mod?.notes ?? '')
  const [notesSaving, setNotesSaving] = useState(false)
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
    setNotesValue(mod?.notes ?? '')
    setEditingNotes(false)
    setSearchQuery('')
    setSelectedNodeId(null)
    setTreeContextMenu(null)
    setTreeActionDialog(null)
    setTreeActionValue('')
    setWinConflictsCollapsed(false)
    setLossConflictsCollapsed(false)
  }, [mod?.name, mod?.notes, mod?.uuid])

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
  const descriptionText = mod.description?.trim() || buildFallbackDescription(mod, visibleFiles.length)
  const hasNexusPage = typeof mod.nexusModId === 'number'
  const hasStoredSource = Boolean(mod.sourcePath?.trim())
  const normalizedNotes = notesValue.trim()
  const notesDirty = normalizedNotes !== (mod.notes ?? '')
  const nameDirty = nameValue.trim() !== mod.name
  const downloadSourceLabel = hasNexusPage
    ? 'Nexus Mods'
    : mod.sourceType === 'directory'
      ? 'Directory Import'
      : mod.sourceType === 'archive'
        ? 'Archive Import'
        : 'Manual'
  const categoryLabel = TYPE_LABEL[mod.type] ?? TYPE_LABEL.unknown
  const modIdLabel = hasNexusPage ? `nexusmods: ${mod.nexusModId}` : `local: ${mod.uuid.slice(0, 8)}`
  const tagChips = [
    categoryLabel.toUpperCase(),
    mod.sourceType === 'archive' ? 'ARCHIVE' : mod.sourceType === 'directory' ? 'DIRECTORY' : 'MANAGED',
    hasNexusPage ? 'NEXUS LINKED' : 'LOCAL ONLY',
    `${visibleFiles.length} FILE${visibleFiles.length === 1 ? '' : 'S'}`,
  ]
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
      ? 'min(980px, calc(100vw - 220px))'
      : 'min(1040px, calc(100vw - 156px))',
    maxWidth: fullscreenLikeViewport ? '980px' : '1040px',
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

  const handleSaveNotes = async () => {
    setNotesSaving(true)
    await updateModMetadata(mod.uuid, { notes: normalizedNotes || undefined })
    setNotesSaving(false)
    setEditingNotes(false)
    addToast(normalizedNotes ? 'Notes saved' : 'Notes cleared', 'success', 1800)
  }

  const handleOpenFolder = async () => {
    if (!modFolderPath) {
      addToast('Library path is not configured', 'warning')
      return
    }

    await IpcService.invoke(IPC.OPEN_PATH, modFolderPath)
  }

  const handleOpenNexus = async () => {
    if (!hasNexusPage || typeof mod.nexusModId !== 'number') {
      addToast('No Nexus page stored for this mod', 'warning')
      return
    }

    await IpcService.invoke(IPC.OPEN_EXTERNAL, `https://www.nexusmods.com/cyberpunk2077/mods/${mod.nexusModId}`)
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

  const handleToggleEnabled = async () => {
    const result = mod.enabled ? await disableMod(mod.uuid) : await enableMod(mod.uuid)
    if (!result.ok) {
      addToast(result.error ?? `Could not ${mod.enabled ? 'disable' : 'enable'} mod`, 'error')
      return
    }

    addToast(`${mod.name} ${mod.enabled ? 'disabled' : 'enabled'}`, 'success', 1800)
  }

  return (
    <div
      className={`fixed inset-0 z-[160] flex items-center justify-center bg-[rgba(0,0,0,0.78)] px-6 backdrop-blur-[3px] fade-in ${
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
          ) : activeTab === 'details' ? (
            <div className="hyperion-scrollbar mt-5 min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-5">
              <section className="border border-[#232323] bg-[#101010] px-5 py-5">
                <div className="flex flex-wrap gap-2">
                  {tagChips.map((tag) => (
                    <span
                      key={tag}
                      className="border border-[#323232] bg-[#141414] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e9e5e2]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <p className="mt-5 max-w-[760px] text-sm leading-8 text-[#c0bcb7]">
                  {descriptionText}
                </p>
              </section>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <SideCard title="Metadata">
                  <MetaRow icon="person" label="Author" value={mod.author?.trim() || 'Unknown'} />
                  <MetaRow icon="stars" label="Version" value={mod.version?.trim() || 'Unknown'} />
                  <MetaRow icon="calendar_month" label="Installed" value={formatWindowsDateTimeOrFallback(mod.installedAt, 'Not tracked')} />
                  <MetaRow icon="hard_drive_2" label="File Size" value={formatSize(mod.fileSize)} />
                  <MetaRow icon="tag" label="Mod ID" value={modIdLabel} />
                  <MetaRow icon="folder" label="Category" value={categoryLabel} />
                  <MetaRow icon="download" label="Download Source" value={downloadSourceLabel} />
                </SideCard>

                <div className="space-y-5">
                  <SideCard
                    title="Notes"
                    action={(
                      <Tooltip content={editingNotes ? 'Close editor' : 'Edit notes'}>
                        <button
                          onClick={() => {
                            if (editingNotes) {
                              setNotesValue(mod.notes ?? '')
                              setEditingNotes(false)
                              return
                            }

                            setEditingNotes(true)
                          }}
                          className="flex h-9 w-9 items-center justify-center border border-[#2a2a2a] bg-[#111] text-[#9a9a9a] transition-colors hover:border-[#4a4a4a] hover:text-white"
                        >
                          <span className="material-symbols-outlined text-[17px]">{editingNotes ? 'close' : 'edit'}</span>
                        </button>
                      </Tooltip>
                    )}
                  >
                    {editingNotes ? (
                      <>
                        <textarea
                          value={notesValue}
                          onChange={(event) => setNotesValue(event.target.value)}
                          placeholder="Add notes about load order, compatibility, favorite presets, or cache hints..."
                          className="allow-text-selection min-h-[128px] w-full border border-[#252525] bg-[#0c0c0c] px-4 py-4 text-sm leading-7 text-[#efebe8] outline-none transition-colors placeholder:text-[#5f5f5f] focus:border-[#4f4911]"
                        />
                        <div className="mt-4 flex gap-2">
                          <button
                            onClick={() => {
                              setNotesValue(mod.notes ?? '')
                              setEditingNotes(false)
                            }}
                            disabled={notesSaving}
                            className="border border-[#2c2c2c] bg-[#121212] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e4dfdc] transition-colors hover:bg-[#171717] hover:text-white disabled:cursor-not-allowed disabled:border-[#1d1d1d] disabled:bg-[#0d0d0d] disabled:text-[#5f5f5f]"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => void handleSaveNotes()}
                            disabled={!notesDirty || notesSaving}
                            className={`border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition-all ${
                              !notesDirty || notesSaving
                                ? 'cursor-not-allowed border-[#1d1d1d] bg-[#0d0d0d] text-[#5f5f5f]'
                                : 'border-[#564f11] bg-[#fcee09] text-[#050505] hover:bg-[#fff38f]'
                            }`}
                          >
                            {notesSaving ? 'Saving...' : 'Save Notes'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm leading-7 text-[#adaba8]">
                        {mod.notes?.trim() || 'No note saved for this mod yet.'}
                      </p>
                    )}
                  </SideCard>

                  {hasStoredSource ? (
                    <SideCard title="Source Path">
                      <div className="break-all text-sm leading-7 text-[#9b9b9b]">
                        {mod.sourcePath}
                      </div>
                      <div className="mt-3 text-sm text-[#7f7f7f]">
                        Last source change: {formatWindowsDateTimeOrFallback(mod.sourceModifiedAt, 'Not tracked')}
                      </div>
                    </SideCard>
                  ) : null}
                </div>
              </div>

              <section className="border border-[#232323] bg-[#0c0c0c] px-5 py-5">
                <div className="grid gap-3 xl:grid-cols-5">
                  <FooterActionButton
                    icon={mod.enabled ? 'block' : 'task_alt'}
                    label={mod.enabled ? 'Disable Mod' : 'Enable Mod'}
                    onClick={() => void handleToggleEnabled()}
                    tone="primary"
                  />
                  <FooterActionButton
                    icon="open_in_new"
                    label="Open On Nexus"
                    onClick={() => void handleOpenNexus()}
                    disabled={!hasNexusPage}
                  />
                  <FooterActionButton
                    icon="download"
                    label="Reinstall"
                    onClick={() => openReinstallPrompt(mod)}
                    disabled={!hasStoredSource}
                  />
                  <FooterActionButton
                    icon="folder_open"
                    label="Open Folder"
                    onClick={() => void handleOpenFolder()}
                  />
                  <FooterActionButton
                    icon="delete"
                    label="Uninstall"
                    onClick={() => onDeleteRequest(mod)}
                    tone="danger"
                  />
                </div>

                <div className="mt-5 flex flex-col gap-2 text-sm text-[#8f8f8f] md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-[#a0a0a0]">info</span>
                    <span>Tip: Conflict details reflect the current library state and update when install order changes.</span>
                  </div>
                  <span>{mod.enabled ? 'Mod installed and ready to use.' : 'Mod stored in library and ready when enabled.'}</span>
                </div>
              </section>
              </div>
            </div>
          ) : (
            <div className="mt-5 min-h-0 flex flex-1 flex-col gap-5">
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
    </div>
  )
}
