import type { ModMetadata } from '@shared/types'
import type { FileTreeEntry, FileTreeNode } from './DetailPanelTypes'

const GAME_ROOT_DIRS = new Set(['archive', 'bin', 'engine', 'mods', 'r6', 'red4ext'])
const ARCHIVE_EXTENSIONS = new Set(['.archive', '.xl'])

export function normalizeRelativePath(relPath: string): string {
  return relPath
    .split(/[\\/]+/)
    .filter((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
    .join('/')
}

function joinRelativePath(...segments: string[]): string {
  return normalizeRelativePath(segments.join('/'))
}

export function joinWindowsPath(basePath: string, relPath?: string): string {
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

export function getDeployRelativePath(mod: ModMetadata, relFile: string): string {
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

export function getDeployRelativeFolderPath(mod: ModMetadata, relFolder: string): string {
  const normalized = normalizeRelativePath(relFolder)
  if (!normalized) return ''
  return getParentRelativePath(getDeployRelativePath(mod, joinRelativePath(normalized, '__hyperion_empty__.keep')))
}

export function buildFileTree(entries: FileTreeEntry[]): FileTreeNode[] {
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

export function collectDefaultExpandedIds(nodes: FileTreeNode[]): Set<string> {
  void nodes
  return new Set<string>()
}

export function collectFolderIds(nodes: FileTreeNode[]): Set<string> {
  const ids = new Set<string>()

  const visit = (node: FileTreeNode) => {
    if (node.kind !== 'folder') return
    ids.add(node.id)
    node.children.forEach(visit)
  }

  nodes.forEach(visit)
  return ids
}

export function filterFileTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
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

export function findFileTreeNode(nodes: FileTreeNode[], nodeId: string | null): FileTreeNode | null {
  if (!nodeId) return null

  for (const node of nodes) {
    if (node.id === nodeId) return node
    const childMatch = findFileTreeNode(node.children, nodeId)
    if (childMatch) return childMatch
  }

  return null
}

export function collectVisibleNodeIds(nodes: FileTreeNode[]): Set<string> {
  const ids = new Set<string>()

  const visit = (node: FileTreeNode) => {
    ids.add(node.id)
    node.children.forEach(visit)
  }

  nodes.forEach(visit)
  return ids
}

export function getExistingNodeRelativePath(node: FileTreeNode | null): string | null {
  if (!node) return null
  if (node.kind === 'folder') return node.sourcePath ?? null
  return node.sourcePath ?? node.path
}

export function getCreateParentRelativePath(node: FileTreeNode | null): string {
  if (!node) return ''
  if (node.kind === 'folder') return node.sourcePath ?? node.path
  return getParentRelativePath(node.sourcePath ?? node.path)
}
