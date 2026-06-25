import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  screen,
  Menu,
  clipboard
} from 'electron'
import fs from 'fs'
import path from 'path'
import { spawn, exec, execFile } from 'child_process'
import { getPathDefaults, loadSettings, saveSettings } from './settings'
import { createSplashWindow } from './splash'
import { initializeUpdates, checkForUpdatesOnStartup, flushCachedUpdateInfo } from './updater'
import {
  registerModManagerHandlers,
  buildEnabledModLinks,
  getDeployRelativePath,
  normalizeRelativePath,
  scanMods,
} from './ipc/modManager'
import { getVfsBridgeDiagnostics, loadVfsBridge, type VfsLink } from './vfsBridge'
import { cleanupInstallerTempDirs, registerInstallerHandlers } from './ipc/installer'
import { registerGameDetectorHandlers } from './ipc/gameDetector'
import { registerNexusDownloaderHandlers } from './ipc/nexusDownloader'
import { IPC, type GameLaunchProgress, type ModMetadata, type VfsOverwriteInfo } from '../shared/types'
import { parseNxmUrl } from '../shared/nxm'
import { clearAppLogs, getAppLogsSnapshot, pushGeneralLog, safeSendToWindow } from './logStore'
import { findNexusDownloadRecordByPath, removeNexusDownloadRecordByPath } from './nexusDownloadRegistry'

const DOWNLOAD_EXTENSIONS = new Set(['.zip', '.rar', '.7z'])
const GAME_EXECUTABLE_RELATIVE_PATH = path.join('bin', 'x64', 'Cyberpunk2077.exe')
const BOOTSTRAP_ROOT_EXTENSIONS = new Set(['.dll', '.asi', '.ini', '.cfg', '.toml', '.json'])
const BOOTSTRAP_PLUGIN_EXTENSIONS = new Set(['.dll', '.asi', '.ini', '.cfg', '.toml', '.json'])
const BOOTSTRAP_TEMP_DIR_MARKER = '.hyperion-vfs-bootstrap.json'
const VFS_OVERWRITE_DIR_NAME = 'Overwrite'
const LEGACY_VFS_OVERWRITE_DIR_NAME = 'vfs-overwrite'
const USVFS_AUXILIARY_PROCESS_BLACKLIST = [
  'CrashReporter.exe',
  'REDEngineErrorReporter.exe',
]

function resolveGameExecutable(gamePath: string): string {
  if (!gamePath) return ''

  const normalizedPath = path.normalize(gamePath)
  try {
    const stats = fs.statSync(normalizedPath)
    if (stats.isDirectory()) {
      return path.join(normalizedPath, GAME_EXECUTABLE_RELATIVE_PATH)
    }
  } catch {
    // Fall through and return the raw path for error reporting via openPath.
  }

  return normalizedPath
}

function resolveGameRootPath(gamePath: string): string {
  if (!gamePath) return ''

  const normalizedPath = path.normalize(gamePath)
  try {
    if (fs.statSync(normalizedPath).isDirectory()) {
      return normalizedPath
    }
  } catch {
    // Fall through and infer from the executable-shaped path below.
  }

  const normalizedLower = normalizedPath.toLowerCase()
  const executableSuffix = GAME_EXECUTABLE_RELATIVE_PATH.toLowerCase()
  if (normalizedLower.endsWith(executableSuffix)) {
    return path.dirname(path.dirname(path.dirname(normalizedPath)))
  }

  return path.dirname(normalizedPath)
}

function isValidConfiguredGamePath(gamePath?: string): boolean {
  const normalizedPath = gamePath?.trim()
  if (!normalizedPath) return false

  try {
    return fs.existsSync(resolveGameExecutable(normalizedPath))
  } catch {
    return false
  }
}

// ─── usvfs VFS launch lifecycle ───────────────────────────────────────────────
// The VFS only exists while this (controller) process keeps it mounted. We mount
// at Launch Game, keep it alive while the game runs, and unmount on game exit.
let vfsMounted = false
let gameExitTimer: NodeJS.Timeout | null = null
let stagedBootstrapEntries: BootstrapStageEntry[] = []
let stagedBootstrapOverrideDirs: string[] = []
let stagedBootstrapTempDirs: BootstrapTempDir[] = []
let activeVfsLaunchContext: ActiveVfsLaunchContext | null = null
let vfsLaunchCancelRequested = false

function unmountVfsIfMounted(): void {
  if (gameExitTimer) {
    clearInterval(gameExitTimer)
    gameExitTimer = null
  }
  if (vfsMounted) {
    try {
      loadVfsBridge()?.unmountVfs()
    } catch {
      // best effort
    }
  }
  vfsMounted = false
  migrateActiveVfsResidueAfterRun()
  cleanupStagedBootstrapFiles()
}

function isGameProcessRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq Cyberpunk2077.exe" /NH /FO CSV', (err, stdout) => {
      resolve(!err && stdout.includes('"Cyberpunk2077.exe"'))
    })
  })
}

function isProcessRunningByPid(pid?: number): Promise<boolean> {
  if (!pid || !Number.isFinite(pid)) return Promise.resolve(false)

  return new Promise((resolve) => {
    exec(`tasklist /FI "PID eq ${Math.trunc(pid)}" /NH /FO CSV`, (err, stdout) => {
      resolve(!err && stdout.includes(`"${Math.trunc(pid)}"`))
    })
  })
}

interface GameModuleSnapshotEntry {
  pid?: number
  module?: string
  path?: string
  error?: string
}

function getGameModuleSnapshot(): Promise<GameModuleSnapshotEntry[]> {
  const script = `
$mods = Get-Process -Name Cyberpunk2077 -ErrorAction SilentlyContinue | ForEach-Object {
  $processId = $_.Id
  try {
    $_.Modules |
      ForEach-Object { [pscustomobject]@{ pid = $processId; module = $_.ModuleName; path = $_.FileName } }
  } catch {
    [pscustomobject]@{ pid = $processId; error = $_.Exception.Message }
  }
}
$mods | ConvertTo-Json -Compress -Depth 3
`

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve([{ error: stderr.trim() || err.message }])
          return
        }

        const raw = stdout.trim()
        if (!raw) {
          resolve([])
          return
        }

        try {
          const parsed = JSON.parse(raw) as GameModuleSnapshotEntry | GameModuleSnapshotEntry[]
          resolve(Array.isArray(parsed) ? parsed : [parsed])
        } catch {
          resolve([{ error: raw }])
        }
      }
    )
  })
}

function getVfsLaunchLogPath(): string {
  return path.join(app.getPath('userData'), 'logs', 'vfs-launch.log')
}

function getLegacyVfsOverwritePath(): string {
  return path.join(app.getPath('userData'), LEGACY_VFS_OVERWRITE_DIR_NAME)
}

function getHyperionManagedRoot(libraryPath?: string): string {
  const normalizedLibraryPath = libraryPath?.trim() ? path.normalize(libraryPath.trim()) : ''
  if (normalizedLibraryPath) {
    const parent = path.dirname(normalizedLibraryPath)
    if (parent && parent !== normalizedLibraryPath) return parent
  }

  return path.dirname(getPathDefaults().libraryPath)
}

function getVfsOverwritePath(libraryPath?: string): string {
  let resolvedLibraryPath = libraryPath?.trim() ?? ''
  if (!resolvedLibraryPath) {
    try {
      resolvedLibraryPath = loadSettings().libraryPath
    } catch {
      resolvedLibraryPath = getPathDefaults().libraryPath
    }
  }

  return path.join(getHyperionManagedRoot(resolvedLibraryPath), VFS_OVERWRITE_DIR_NAME)
}

function migrateLegacyVfsOverwrite(targetPath: string): void {
  const legacyPath = getLegacyVfsOverwritePath()
  const resolvedLegacy = path.resolve(legacyPath)
  const resolvedTarget = path.resolve(targetPath)

  if (resolvedLegacy === resolvedTarget || !fs.existsSync(legacyPath)) return

  fs.mkdirSync(targetPath, { recursive: true })
  let moved = 0
  let removedDuplicates = 0
  let conflicts = 0

  for (const sourceFile of collectFilesRecursive(legacyPath)) {
    const relFile = normalizeRelativePath(path.relative(legacyPath, sourceFile))
    const targetFile = path.resolve(targetPath, relFile)
    if (!isInsidePath(targetFile, targetPath)) continue

    if (!fs.existsSync(targetFile)) {
      copyFilePreservingTimes(sourceFile, targetFile)
      fs.rmSync(sourceFile, { force: true })
      moved += 1
    } else if (filesAreEqual(sourceFile, targetFile)) {
      fs.rmSync(sourceFile, { force: true })
      removedDuplicates += 1
    } else {
      const conflictPath = allocateConflictPath(targetFile, 'appdata-migration')
      copyFilePreservingTimes(sourceFile, conflictPath)
      fs.rmSync(sourceFile, { force: true })
      moved += 1
      conflicts += 1
    }

    removeEmptyDirsUpTo(path.dirname(sourceFile), legacyPath)
  }

  try {
    fs.rmdirSync(legacyPath)
  } catch {
    // Leave the legacy folder behind if some process still owns a file.
  }

  appendVfsLaunchLog('vfs overwrite location migrated', {
    from: legacyPath,
    to: targetPath,
    moved,
    removedDuplicates,
    conflicts,
  })
}

function ensureVfsOverwritePath(libraryPath?: string): string {
  const overwritePath = getVfsOverwritePath(libraryPath)
  fs.mkdirSync(overwritePath, { recursive: true })
  migrateLegacyVfsOverwrite(overwritePath)
  return overwritePath
}

function collectVfsOverwriteInfo(): VfsOverwriteInfo {
  const overwritePath = ensureVfsOverwritePath()
  const info: VfsOverwriteInfo = {
    path: overwritePath,
    exists: fs.existsSync(overwritePath),
    fileCount: 0,
    directoryCount: 0,
    totalBytes: 0,
  }

  if (!info.exists) return info

  const walk = (dir: string): void => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      try {
        const stat = fs.statSync(entryPath)
        if (!info.updatedAt || stat.mtime > new Date(info.updatedAt)) {
          info.updatedAt = stat.mtime.toISOString()
        }

        if (entry.isDirectory()) {
          info.directoryCount += 1
          walk(entryPath)
        } else if (entry.isFile()) {
          info.fileCount += 1
          info.totalBytes += stat.size
        }
      } catch {
        // Best-effort UI metadata; unreadable files should not break the app.
      }
    }
  }

  walk(overwritePath)
  return info
}

function isVolatileOverwriteFile(relFile: string): boolean {
  const normalized = normalizeRelativePath(relFile).toLowerCase()
  const baseName = path.basename(normalized)
  const extension = path.extname(baseName)

  if (
    baseName.includes('.physical-conflict-')
    || baseName.includes('.overwrite-backup-')
    || baseName.includes('.appdata-migration-')
  ) {
    return true
  }

  if (extension === '.log' || extension === '.tmp' || extension === '.dmp') return true
  if (normalized.startsWith(normalizeRelativePath(path.join('red4ext', 'logs')).toLowerCase() + path.sep)) return true
  if (normalized.startsWith(normalizeRelativePath(path.join('r6', 'logs')).toLowerCase() + path.sep)) return true

  const cetRoot = normalizeRelativePath(path.join('bin', 'x64', 'plugins', 'cyber_engine_tweaks')).toLowerCase()
  if (
    normalized.startsWith(cetRoot + path.sep)
    && ['cyber_engine_tweaks.log', 'gamelog.log', 'scripting.log'].includes(baseName)
  ) {
    return true
  }

  return false
}

function cleanVfsOverwriteVolatileFiles(overwritePath: string): VfsOverwriteCleanResult {
  const result: VfsOverwriteCleanResult = { removed: 0, removedBytes: 0, errors: [] }
  if (!fs.existsSync(overwritePath)) return result

  for (const filePath of collectFilesRecursive(overwritePath)) {
    const relFile = normalizeRelativePath(path.relative(overwritePath, filePath))
    if (!isVolatileOverwriteFile(relFile)) continue

    try {
      const stat = fs.statSync(filePath)
      fs.rmSync(filePath, { force: true })
      result.removed += 1
      result.removedBytes += stat.size
      removeEmptyDirsInside(path.dirname(filePath), overwritePath)
    } catch (error) {
      result.errors.push({
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  fs.mkdirSync(overwritePath, { recursive: true })
  return result
}

function buildVfsOverwriteReadLinks(gameRoot: string, overwritePath: string): VfsLink[] {
  if (!fs.existsSync(overwritePath)) return []

  const links: VfsLink[] = []
  for (const filePath of collectFilesRecursive(overwritePath)) {
    const relFile = normalizeRelativePath(path.relative(overwritePath, filePath))
    if (!relFile || isVolatileOverwriteFile(relFile)) continue

    links.push({
      source: filePath,
      dest: path.join(gameRoot, relFile),
      dir: false,
    })
  }

  return links
}

function clearVfsOverwrite(): { ok: boolean; data?: VfsOverwriteInfo; error?: string } {
  const overwritePath = ensureVfsOverwritePath()
  const resolvedOverwrite = path.resolve(overwritePath)
  const resolvedManagedRoot = path.resolve(getHyperionManagedRoot(loadSettings().libraryPath))

  if (!isInsidePath(resolvedOverwrite, resolvedManagedRoot)) {
    return { ok: false, error: 'Overwrite path resolved outside Hyperion managed folder' }
  }

  try {
    if (!fs.existsSync(overwritePath)) {
      fs.mkdirSync(overwritePath, { recursive: true })
      return { ok: true, data: collectVfsOverwriteInfo() }
    }

    const cleanResult = cleanVfsOverwriteVolatileFiles(overwritePath)
    appendVfsLaunchLog('vfs overwrite cleaned', { overwritePath, ...cleanResult })
    return { ok: true, data: collectVfsOverwriteInfo() }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function toLoggableDetails(details?: unknown): unknown {
  if (details instanceof Error) {
    return { error: details.message, stack: details.stack }
  }
  return details
}

function appendVfsLaunchLog(message: string, details?: unknown): void {
  try {
    const logPath = getVfsLaunchLogPath()
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(
      logPath,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        message,
        details: toLoggableDetails(details),
      })}\n`,
      'utf8'
    )
  } catch {
    // Diagnostics must never block launching.
  }
}

interface BootstrapStageEntry {
  source: string
  dest: string
  deployPath: string
  modName?: string
  modFolderName?: string
  status: 'copied' | 'already-present' | 'existing-kept' | 'error'
  error?: string
}

interface BootstrapCandidate {
  source: string
  dest: string
  deployPath: string
  modName?: string
  modFolderName?: string
}

interface BootstrapTempDir {
  dir: string
  markerPath: string
  deployPath: string
  modName?: string
  modFolderName?: string
}

interface DeployFileEntry {
  relFile: string
  deployPath: string
  source: string
  modName?: string
  modFolderName?: string
}

interface VfsResidueMigrationResult {
  relDir: string
  status: 'migrated' | 'skipped' | 'error'
  moved: number
  removedDuplicates: number
  conflicts: number
  error?: string
}

interface VfsOverwriteCleanResult {
  removed: number
  removedBytes: number
  errors: Array<{ path: string; error: string }>
}

interface ActiveVfsLaunchContext {
  gameRoot: string
  libraryPath: string
  enabledMods: ModMetadata[]
}

function filesAreEqual(leftPath: string, rightPath: string): boolean {
  try {
    const leftStat = fs.statSync(leftPath)
    const rightStat = fs.statSync(rightPath)
    if (leftStat.size !== rightStat.size) return false

    return fs.readFileSync(leftPath).equals(fs.readFileSync(rightPath))
  } catch {
    return false
  }
}

function readBootstrapConfigContent(sourcePath: string): string {
  try {
    return fs.readFileSync(sourcePath, 'utf8')
  } catch {
    return '[GlobalSets]\nLoadPlugins=1\nLoadFromScriptsOnly=1\n'
  }
}

function isVfsBootstrapDeployPath(deployPath: string): boolean {
  const parts = normalizeRelativePath(deployPath).split(path.sep).filter(Boolean)
  const lowerParts = parts.map((part) => part.toLowerCase())

  // RED4ext framework files sit directly under red4ext/ (e.g. RED4ext.dll).
  // RED4ext's winmm.dll proxy is a STATIC import of Cyberpunk2077.exe, so it
  // initializes during the game's loader/DllMain phase — BEFORE usvfs file hooks
  // are active (proven: usvfs redirection is not live in a static-import
  // DllMain). It reads its config and runs create_directories(red4ext/logs)
  // against the REAL disk, so red4ext/ MUST exist physically or RED4ext aborts
  // with "creating the logs directory: The system cannot find the file
  // specified". red4ext/plugins/** is intentionally excluded: RED4ext loads
  // plugins after init, when hooks are live, so plugins stay virtual.
  if (lowerParts[0] === 'red4ext' && parts.length === 2) {
    return BOOTSTRAP_ROOT_EXTENSIONS.has(path.extname(parts[1]).toLowerCase())
  }

  if (lowerParts[0] !== 'bin' || lowerParts[1] !== 'x64') return false

  const extension = path.extname(parts[parts.length - 1] ?? '').toLowerCase()
  if (parts.length === 3) {
    return BOOTSTRAP_ROOT_EXTENSIONS.has(extension)
  }

  if (parts.length === 4 && lowerParts[2] === 'plugins') {
    return BOOTSTRAP_PLUGIN_EXTENSIONS.has(extension)
  }

  return false
}

// Top-level extender directory Hyperion creates when staging early-init
// bootstrap files (and removes recursively on game exit if it created it).
// bin/x64 itself is a base-game directory and is never a managed root.
function getBootstrapManagedRoot(deployPath: string): string | null {
  const parts = normalizeRelativePath(deployPath).split(path.sep).filter(Boolean)
  const lower = parts.map((part) => part.toLowerCase())
  if (lower[0] === 'red4ext' && parts.length >= 2) return 'red4ext'
  if (lower[0] === 'bin' && lower[1] === 'x64' && lower[2] === 'plugins' && parts.length >= 4) {
    return path.join('bin', 'x64', 'plugins')
  }
  return null
}

function getPluginSupportDeployPrefix(deployPath: string): string | null {
  const parts = normalizeRelativePath(deployPath).split(path.sep).filter(Boolean)
  const lowerParts = parts.map((part) => part.toLowerCase())
  if (lowerParts[0] !== 'bin' || lowerParts[1] !== 'x64' || lowerParts[2] !== 'plugins') {
    return null
  }
  if (parts.length !== 4) return null

  const extension = path.extname(parts[3]).toLowerCase()
  if (extension !== '.asi' && extension !== '.dll') return null

  return path.join(parts[0], parts[1], parts[2], path.basename(parts[3], extension))
}

function getEnabledDeployFiles(libraryPath: string, enabledMods: ModMetadata[]): DeployFileEntry[] {
  const entries: DeployFileEntry[] = []

  for (const mod of enabledMods) {
    const modDir = path.join(libraryPath, mod.folderName ?? mod.uuid)
    const modFiles = (Array.isArray(mod.files) ? mod.files : [])
      .map((relFile) => normalizeRelativePath(relFile))
      .filter((relFile) => Boolean(relFile) && relFile !== '_metadata.json')

    for (const relFile of modFiles) {
      entries.push({
        relFile,
        deployPath: normalizeRelativePath(getDeployRelativePath(mod, relFile)),
        source: path.join(modDir, relFile),
        modName: mod.name,
        modFolderName: mod.folderName,
      })
    }
  }

  return entries
}

function getPluginRuntimeDirFromDeployPath(deployPath: string): string | null {
  const parts = normalizeRelativePath(deployPath).split(path.sep).filter(Boolean)
  const lowerParts = parts.map((part) => part.toLowerCase())

  if (lowerParts[0] === 'bin' && lowerParts[1] === 'x64' && lowerParts[2] === 'plugins' && parts.length >= 5) {
    return path.join(parts[0], parts[1], parts[2], parts[3])
  }

  if (lowerParts[0] === 'red4ext' && lowerParts[1] === 'plugins' && parts.length >= 3) {
    return path.join(parts[0], parts[1], parts[2])
  }

  return null
}

function pathKey(value: string): string {
  return path.normalize(value).toLowerCase()
}

function isInsidePath(childPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function collectFilesRecursive(rootDir: string): string[] {
  const files: string[] = []

  const walk = (dir: string): void => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
      } else if (entry.isFile()) {
        files.push(entryPath)
      }
    }
  }

  walk(rootDir)
  return files
}

function removeEmptyDirsUpTo(startDir: string, stopDir: string): number {
  let removed = 0
  let current = path.resolve(startDir)
  const stop = path.resolve(stopDir)

  while (current === stop || isInsidePath(current, stop)) {
    try {
      fs.rmdirSync(current)
      removed += 1
    } catch {
      break
    }

    if (current === stop) break
    current = path.dirname(current)
  }

  return removed
}

function copyFilePreservingTimes(source: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(source, dest)
  try {
    const stat = fs.statSync(source)
    fs.utimesSync(dest, stat.atime, stat.mtime)
  } catch {
    // Preserving timestamps is useful for conflict resolution but not required.
  }
}

function replaceOverwriteFileWithRuntimeFile(physicalFile: string, overwriteFile: string): 'moved' | 'removed' {
  if (fs.existsSync(overwriteFile)) {
    if (filesAreEqual(physicalFile, overwriteFile)) {
      fs.rmSync(physicalFile, { force: true })
      return 'removed'
    }

    const physicalStat = fs.statSync(physicalFile)
    const overwriteStat = fs.statSync(overwriteFile)
    if (physicalStat.mtimeMs < overwriteStat.mtimeMs) {
      fs.rmSync(physicalFile, { force: true })
      return 'removed'
    }
  }

  copyFilePreservingTimes(physicalFile, overwriteFile)
  fs.rmSync(physicalFile, { force: true })
  return 'moved'
}

function removeEmptyDirsInside(startDir: string, rootDir: string): number {
  let removed = 0
  let current = path.resolve(startDir)
  const root = path.resolve(rootDir)

  while (isInsidePath(current, root)) {
    try {
      fs.rmdirSync(current)
      removed += 1
    } catch {
      break
    }
    current = path.dirname(current)
  }

  return removed
}

function allocateConflictPath(targetPath: string, label: string): string {
  const parsed = path.parse(targetPath)
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  let attempt = 1
  let candidate = path.join(parsed.dir, `${parsed.name}.${label}-${stamp}${parsed.ext}`)

  while (fs.existsSync(candidate)) {
    attempt += 1
    candidate = path.join(parsed.dir, `${parsed.name}.${label}-${stamp}-${attempt}${parsed.ext}`)
  }

  return candidate
}

function looksLikeRuntimePluginDirectory(dir: string): boolean {
  const runtimeFileExtensions = new Set(['.bin', '.db', '.json', '.log', '.sqlite', '.sqlite3', '.tmp'])
  const runtimeDirectoryNames = new Set(['cache', 'logs', 'mods', 'persistent'])
  const pending = [dir]
  let inspected = 0

  while (pending.length > 0 && inspected < 200) {
    const current = pending.pop()
    if (!current) break

    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      inspected += 1
      const lowerName = entry.name.toLowerCase()
      if (entry.isDirectory()) {
        if (runtimeDirectoryNames.has(lowerName)) return true
        pending.push(path.join(current, entry.name))
      } else if (entry.isFile() && runtimeFileExtensions.has(path.extname(lowerName))) {
        return true
      }
    }
  }

  return false
}

function collectVfsResidueDirs(gameRoot: string, deployFiles: DeployFileEntry[]): string[] {
  const candidates = new Set<string>()
  const staticRuntimeDirs = [
    path.join('red4ext', 'logs'),
  ]

  for (const relDir of staticRuntimeDirs) {
    candidates.add(normalizeRelativePath(relDir))
  }

  for (const deployFile of deployFiles) {
    const supportDir = getPluginSupportDeployPrefix(deployFile.deployPath)
    if (supportDir) candidates.add(normalizeRelativePath(supportDir))

    const runtimeDir = getPluginRuntimeDirFromDeployPath(deployFile.deployPath)
    if (runtimeDir) candidates.add(normalizeRelativePath(runtimeDir))
  }

  const physicalPluginRoot = path.join(gameRoot, 'bin', 'x64', 'plugins')
  try {
    for (const entry of fs.readdirSync(physicalPluginRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const physicalDir = path.join(physicalPluginRoot, entry.name)
      if (!looksLikeRuntimePluginDirectory(physicalDir)) continue
      candidates.add(normalizeRelativePath(path.join('bin', 'x64', 'plugins', entry.name)))
    }
  } catch {
    // Missing plugin root is fine; Cyberpunk may not have created it yet.
  }

  return Array.from(candidates).sort((left, right) => left.localeCompare(right))
}

function migratePhysicalResidueDir(
  gameRoot: string,
  overwriteRoot: string,
  relDir: string,
  deployFileMap: Map<string, string>
): VfsResidueMigrationResult {
  const physicalDir = path.resolve(gameRoot, relDir)
  const resolvedGameRoot = path.resolve(gameRoot)
  const resolvedOverwriteRoot = path.resolve(overwriteRoot)
  const result: VfsResidueMigrationResult = {
    relDir,
    status: 'skipped',
    moved: 0,
    removedDuplicates: 0,
    conflicts: 0,
  }

  try {
    if (!isInsidePath(physicalDir, resolvedGameRoot) || !fs.existsSync(physicalDir)) {
      return result
    }

    const dirStat = fs.statSync(physicalDir)
    if (!dirStat.isDirectory()) return result

    const files = collectFilesRecursive(physicalDir)
    for (const physicalFile of files) {
      const relFile = normalizeRelativePath(path.relative(resolvedGameRoot, physicalFile))
      const overwriteFile = path.resolve(resolvedOverwriteRoot, relFile)
      if (!isInsidePath(overwriteFile, resolvedOverwriteRoot)) {
        throw new Error(`Refusing to migrate outside overwrite folder: ${relFile}`)
      }

      const virtualSource = deployFileMap.get(pathKey(relFile))
      if (virtualSource) {
        if (filesAreEqual(virtualSource, physicalFile)) {
          fs.rmSync(physicalFile, { force: true })
          result.removedDuplicates += 1
        } else {
          const action = replaceOverwriteFileWithRuntimeFile(physicalFile, overwriteFile)
          if (action === 'moved') result.moved += 1
          else result.removedDuplicates += 1
        }
      } else if (!fs.existsSync(overwriteFile)) {
        copyFilePreservingTimes(physicalFile, overwriteFile)
        fs.rmSync(physicalFile, { force: true })
        result.moved += 1
      } else if (filesAreEqual(physicalFile, overwriteFile)) {
        fs.rmSync(physicalFile, { force: true })
        result.removedDuplicates += 1
      } else {
        const action = replaceOverwriteFileWithRuntimeFile(physicalFile, overwriteFile)
        if (action === 'moved') result.moved += 1
        else result.removedDuplicates += 1
      }

      removeEmptyDirsUpTo(path.dirname(physicalFile), physicalDir)
    }

    removeEmptyDirsUpTo(physicalDir, physicalDir)
    if (result.moved > 0 || result.removedDuplicates > 0 || result.conflicts > 0) {
      result.status = 'migrated'
    }
    return result
  } catch (error) {
    return {
      ...result,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function migrateVfsPhysicalResidue(
  gameRoot: string,
  libraryPath: string,
  enabledMods: ModMetadata[]
): VfsResidueMigrationResult[] {
  const overwriteRoot = ensureVfsOverwritePath(libraryPath)

  const deployFiles = getEnabledDeployFiles(libraryPath, enabledMods)
  const deployFileMap = new Map<string, string>()
  for (const entry of deployFiles) {
    deployFileMap.set(pathKey(entry.deployPath), entry.source)
  }

  return collectVfsResidueDirs(gameRoot, deployFiles)
    .map((relDir) => migratePhysicalResidueDir(gameRoot, overwriteRoot, relDir, deployFileMap))
    .filter((result) => result.status !== 'skipped')
}

function migrateActiveVfsResidueAfterRun(): void {
  const context = activeVfsLaunchContext
  activeVfsLaunchContext = null
  if (!context?.libraryPath) return

  try {
    const residueMigration = migrateVfsPhysicalResidue(
      context.gameRoot,
      context.libraryPath,
      context.enabledMods
    )
    appendVfsLaunchLog('vfs physical residue post-run migration result', {
      migrated: residueMigration.filter((entry) => entry.status === 'migrated').length,
      errors: residueMigration.filter((entry) => entry.status === 'error').length,
      entries: residueMigration,
    })

    const cleanResult = cleanVfsOverwriteVolatileFiles(ensureVfsOverwritePath(context.libraryPath))
    appendVfsLaunchLog('vfs overwrite post-run volatile cleanup result', cleanResult)
  } catch (error) {
    appendVfsLaunchLog('vfs physical residue post-run migration failed', error)
  }
}

function getExpectedBootstrapModuleNames(entries: BootstrapStageEntry[]): string[] {
  const names = new Set<string>()
  for (const entry of entries) {
    if (entry.status === 'error' || entry.status === 'existing-kept') continue

    const extension = path.extname(entry.deployPath).toLowerCase()
    if (extension !== '.dll' && extension !== '.asi') continue

    names.add(path.basename(entry.deployPath).toLowerCase())
  }
  return Array.from(names)
}

function isWindowsSystemModulePath(modulePath?: string): boolean {
  return /\\windows\\(system32|syswow64)\\/i.test(modulePath ?? '')
}

function stageBootstrapFile(
  source: string,
  dest: string,
  deployPath: string,
  modName?: string,
  modFolderName?: string
): BootstrapStageEntry {
  const base = { source, dest, deployPath, modName, modFolderName }

  try {
    if (!fs.existsSync(source)) {
      return { ...base, status: 'error', error: 'Source file does not exist' }
    }

    const isGlobalIni = path.basename(dest).toLowerCase() === 'global.ini'
    if (fs.existsSync(dest)) {
      if (isGlobalIni) {
        const desiredContent = readBootstrapConfigContent(source)
        const currentContent = fs.readFileSync(dest, 'utf8')
        if (currentContent === desiredContent) {
          return { ...base, status: 'already-present' }
        }

        return { ...base, status: 'existing-kept' }
      }

      return {
        ...base,
        status: filesAreEqual(source, dest) ? 'already-present' : 'existing-kept',
      }
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true })
    if (isGlobalIni) {
      fs.writeFileSync(dest, readBootstrapConfigContent(source), 'utf8')
    } else {
      fs.copyFileSync(source, dest)
    }
    return { ...base, status: 'copied' }
  } catch (error) {
    return {
      ...base,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function stageVfsBootstrapFiles(
  gameRoot: string,
  libraryPath: string,
  enabledMods: ModMetadata[]
): { ok: boolean; entries: BootstrapStageEntry[]; tempDirs: BootstrapTempDir[]; error?: string } {
  const candidates = new Map<string, BootstrapCandidate>()
  const tempDirs = new Map<string, BootstrapTempDir>()

  for (const mod of enabledMods) {
    const modDir = path.join(libraryPath, mod.folderName ?? mod.uuid)
    const modFiles = (Array.isArray(mod.files) ? mod.files : [])
      .map((relFile) => normalizeRelativePath(relFile))
      .filter((relFile) => Boolean(relFile) && relFile !== '_metadata.json')

    const deployFiles = modFiles.map((relFile) => ({
      relFile,
      deployPath: normalizeRelativePath(getDeployRelativePath(mod, relFile)),
    }))

    for (const { relFile: normalizedRelFile, deployPath } of deployFiles) {
      if (!isVfsBootstrapDeployPath(deployPath)) continue

      const source = path.join(modDir, normalizedRelFile)
      const dest = path.join(gameRoot, deployPath)
      candidates.set(deployPath.toLowerCase(), {
        source,
        dest,
        deployPath,
        modName: mod.name,
        modFolderName: mod.folderName,
      })

      // NOTE: we intentionally do NOT physically stage a plugin's support folder
      // (e.g. bin/x64/plugins/cyber_engine_tweaks/ with its fonts/scripts/tweakdb).
      // Only the import-time proxy modules (top-level bin/x64 DLL/ASI/INI) need to
      // exist on disk; the support assets are read at runtime after the plugin has
      // loaded, when usvfs hooks are active, so they stay virtual. This keeps the
      // physical footprint in the game folder to a few small loader files.
    }
  }

  // Extender root dirs (red4ext/, bin/x64/plugins/) that Hyperion must create to
  // stage early-init files into. Only track ones that did NOT already exist, so
  // a user's own pre-existing install is never recursively removed. Each gets a
  // marker; cleanup removes the whole dir (with any runtime logs/config/caches
  // the extender wrote into it) on game exit, keeping the game folder clean.
  for (const candidate of candidates.values()) {
    const managedRoot = getBootstrapManagedRoot(candidate.deployPath)
    if (!managedRoot) continue
    const key = managedRoot.toLowerCase()
    if (tempDirs.has(key)) continue
    const dir = path.join(gameRoot, managedRoot)
    if (fs.existsSync(dir)) continue
    tempDirs.set(key, {
      dir,
      markerPath: path.join(dir, '.hyperion-vfs-bootstrap'),
      deployPath: managedRoot,
    })
  }

  for (const tempDir of tempDirs.values()) {
    try {
      fs.mkdirSync(tempDir.dir, { recursive: true })
      fs.writeFileSync(
        tempDir.markerPath,
        JSON.stringify({
          owner: 'Hyperion',
          purpose: 'temporary VFS bootstrap support directory',
          deployPath: tempDir.deployPath,
          createdAt: new Date().toISOString(),
        }, null, 2),
        'utf8'
      )
    } catch {
      // File copy failures below will surface the actionable path if staging cannot proceed.
    }
  }

  const entries = Array.from(candidates.values()).map((candidate) =>
    stageBootstrapFile(
      candidate.source,
      candidate.dest,
      candidate.deployPath,
      candidate.modName,
      candidate.modFolderName
    )
  )

  const failed = entries.filter((entry) => entry.status === 'error')
  return {
    ok: failed.length === 0,
    entries,
    tempDirs: Array.from(tempDirs.values()),
    error: failed.length > 0 ? `${failed.length} bootstrap file(s) could not be staged` : undefined,
  }
}

function createBootstrapOverrideLinks(entries: BootstrapStageEntry[]): {
  links: Array<{ source: string; dest: string; dir: boolean }>
  dirs: string[]
} {
  const links: Array<{ source: string; dest: string; dir: boolean }> = []
  const dirs: string[] = []
  const configEntries = entries.filter((entry) =>
    entry.status !== 'error'
    && path.basename(entry.deployPath).toLowerCase() === 'global.ini'
  )
  if (configEntries.length === 0) return { links, dirs }

  const overrideRoot = path.join(
    app.getPath('userData'),
    'vfs-bootstrap-overrides',
    `${Date.now()}-${process.pid}`
  )
  dirs.push(overrideRoot)

  for (const entry of configEntries) {
    const overridePath = path.join(overrideRoot, entry.deployPath)
    fs.mkdirSync(path.dirname(overridePath), { recursive: true })
    fs.writeFileSync(overridePath, readBootstrapConfigContent(entry.source), 'utf8')
    links.push({ source: overridePath, dest: entry.dest, dir: false })
  }

  return { links, dirs }
}

function bootstrapFileStillMatches(entry: BootstrapStageEntry): boolean {
  try {
    if (!fs.existsSync(entry.dest)) return false

    if (path.basename(entry.dest).toLowerCase() === 'global.ini') {
      return fs.readFileSync(entry.dest, 'utf8') === readBootstrapConfigContent(entry.source)
    }

    return filesAreEqual(entry.source, entry.dest)
  } catch {
    return false
  }
}

function cleanupStagedBootstrapFiles(): void {
  if (
    stagedBootstrapEntries.length === 0
    && stagedBootstrapOverrideDirs.length === 0
    && stagedBootstrapTempDirs.length === 0
  ) return

  const cleanupEntries = stagedBootstrapEntries
  const cleanupOverrideDirs = stagedBootstrapOverrideDirs
  const cleanupTempDirs = stagedBootstrapTempDirs
  stagedBootstrapEntries = []
  stagedBootstrapOverrideDirs = []
  stagedBootstrapTempDirs = []
  const results: Array<{ dest: string; deployPath: string; status: 'removed' | 'skipped' | 'error'; error?: string }> = []

  for (const entry of cleanupEntries) {
    if (entry.status !== 'copied') continue
    try {
      if (!bootstrapFileStillMatches(entry)) {
        results.push({ dest: entry.dest, deployPath: entry.deployPath, status: 'skipped' })
        continue
      }

      fs.rmSync(entry.dest, { force: true })
      results.push({ dest: entry.dest, deployPath: entry.deployPath, status: 'removed' })
    } catch (error) {
      results.push({
        dest: entry.dest,
        deployPath: entry.deployPath,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const tempDirResults: Array<{ dir: string; deployPath: string; status: 'removed' | 'skipped' | 'error'; error?: string }> = []
  for (const tempDir of cleanupTempDirs) {
    try {
      if (!fs.existsSync(tempDir.markerPath)) {
        tempDirResults.push({ dir: tempDir.dir, deployPath: tempDir.deployPath, status: 'skipped' })
        continue
      }

      fs.rmSync(tempDir.dir, { recursive: true, force: true })
      tempDirResults.push({ dir: tempDir.dir, deployPath: tempDir.deployPath, status: 'removed' })
    } catch (error) {
      tempDirResults.push({
        dir: tempDir.dir,
        deployPath: tempDir.deployPath,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const overrideResults: Array<{ dir: string; status: 'removed' | 'error'; error?: string }> = []
  for (const dir of cleanupOverrideDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      overrideResults.push({ dir, status: 'removed' })
    } catch (error) {
      overrideResults.push({
        dir,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  appendVfsLaunchLog('vfs bootstrap cleanup result', {
    entries: results,
    tempDirs: tempDirResults,
    overrides: overrideResults,
  })
}

function makeVfsLaunchError(message: string): string {
  return `${message}. See ${getVfsLaunchLogPath()}`
}

// Poll for the launched game PID: once it disappears and no process remains
// attached to the VFS, tear down staging promptly.
function startGameExitMonitor(launchedPid?: number): void {
  if (gameExitTimer) clearInterval(gameExitTimer)
  let seenRunning = Boolean(launchedPid)
  let elapsedSeconds = 0
  let missingChecks = 0
  gameExitTimer = setInterval(() => {
    elapsedSeconds += 4
    const runningPromise = launchedPid
      ? isProcessRunningByPid(launchedPid)
      : isGameProcessRunning()

    void runningPromise.then((running) => {
      let attachedToVfs = false
      let vfsProcessCount = 0
      try {
        vfsProcessCount = (loadVfsBridge()?.vfsProcesses?.() ?? []).length
        attachedToVfs = vfsProcessCount > 0
      } catch {
        attachedToVfs = false
      }

      if (running || attachedToVfs) {
        seenRunning = true
        missingChecks = 0
        return
      }

      if (!seenRunning && elapsedSeconds < 20) {
        return
      }

      missingChecks += 1
      appendVfsLaunchLog('vfs exit monitor missing game', {
        elapsedSeconds,
        launchedPid,
        missingChecks,
        running,
        vfsProcessCount,
      })
      if (missingChecks >= 1) {
        unmountVfsIfMounted()
      }
    })
  }, 4000)
}

function isUsableDirectoryPath(targetPath?: string): boolean {
  if (!targetPath?.trim()) return false
  if (!path.isAbsolute(targetPath)) return false

  if (fs.existsSync(targetPath)) {
    try {
      return fs.statSync(targetPath).isDirectory()
    } catch {
      return false
    }
  }

  const parentDir = path.dirname(targetPath)
  if (!parentDir || parentDir === targetPath) return false

  try {
    return fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()
  } catch {
    return false
  }
}

function collectDownloadEntries(dirPath: string, limit = 500): Array<{
  path: string
  name: string
  size: number
  modifiedAt: string
  downloadedAt?: string
  extension: string
  nxmModId?: number
  nxmFileId?: number
  version?: string
}> {
  if (!dirPath || !fs.existsSync(dirPath)) return []

  const results: Array<{
    path: string
    name: string
    size: number
    modifiedAt: string
    downloadedAt?: string
    extension: string
    nxmModId?: number
    nxmFileId?: number
    version?: string
  }> = []

  const visit = (currentDir: string): void => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
        continue
      }
      const extension = path.extname(entry.name).toLowerCase()
      if (!DOWNLOAD_EXTENSIONS.has(extension)) continue
      const stats = fs.statSync(fullPath)
      const nexusRecord = findNexusDownloadRecordByPath(fullPath)
      results.push({
        path: fullPath,
        name: entry.name,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        downloadedAt: nexusRecord?.createdAt,
        extension,
        nxmModId: nexusRecord?.modId,
        nxmFileId: nexusRecord?.fileId,
        version: nexusRecord?.version,
      })
    }
  }

  visit(dirPath)

  return results
    .sort((left, right) => {
      const rightOrderTs = Date.parse(right.downloadedAt ?? right.modifiedAt)
      const leftOrderTs = Date.parse(left.downloadedAt ?? left.modifiedAt)
      if (rightOrderTs !== leftOrderTs) return rightOrderTs - leftOrderTs

      const rightModifiedTs = Date.parse(right.modifiedAt)
      const leftModifiedTs = Date.parse(left.modifiedAt)
      if (rightModifiedTs !== leftModifiedTs) return rightModifiedTs - leftModifiedTs

      return right.name.localeCompare(left.name, undefined, { sensitivity: 'base' })
    })
    .slice(0, limit)
}

app.setName('Hyperion')

if (process.platform === 'win32') {
  app.setAppUserModelId('com.hyperion.modmanager')
}

if (!app.isPackaged) {
  app.setPath('sessionData', path.join(app.getPath('temp'), 'Hyperion-dev-session', String(process.pid)))
}

let mainWindow: BrowserWindow | null = null
let rendererReady = false
const pendingNxmUrls: string[] = []

function normalizeNxmProtocolArg(value?: string): string | null {
  if (!value) return null
  const normalized = value.trim().replace(/^"+|"+$/g, '')
  return /^nxm:\/\//i.test(normalized) ? normalized : null
}

function findNxmProtocolArg(args: string[]): string | null {
  for (const arg of args) {
    const normalized = normalizeNxmProtocolArg(arg)
    if (normalized) return normalized
  }
  return null
}

function describeNxmUrl(raw: string): Record<string, unknown> {
  const parsed = parseNxmUrl(raw)
  if (!parsed) return { rawScheme: 'nxm', parsed: false }
  return {
    rawScheme: 'nxm',
    parsed: true,
    modId: parsed.modId,
    fileId: parsed.fileId,
  }
}

const startupNxmArg = findNxmProtocolArg(process.argv)
if (startupNxmArg) {
  pendingNxmUrls.push(startupNxmArg)
  pushGeneralLog(mainWindow, {
    level: 'info',
    source: 'nexus',
    message: 'NXM link detected in startup arguments',
    details: describeNxmUrl(startupNxmArg),
  })
}

function flushPendingNxmUrls(): void {
  if (!rendererReady || !mainWindow) return

  while (pendingNxmUrls.length > 0) {
    const nextUrl = pendingNxmUrls[0]
    if (!safeSendToWindow(mainWindow, IPC.NXM_LINK_RECEIVED, nextUrl)) {
      return
    }
    pendingNxmUrls.shift()
  }
}

function enqueueOrSendNxmUrl(url: string): void {
  if (!rendererReady || !mainWindow || !safeSendToWindow(mainWindow, IPC.NXM_LINK_RECEIVED, url)) {
    pendingNxmUrls.push(url)
    return
  }

  flushPendingNxmUrls()
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

app.on('second-instance', (_event, argv) => {
  const nxm = findNxmProtocolArg(argv)
  if (nxm) {
    pushGeneralLog(mainWindow, {
      level: 'info',
      source: 'nexus',
      message: 'NXM link received from second instance',
      details: describeNxmUrl(nxm),
    })
    enqueueOrSendNxmUrl(nxm)
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('open-url', (_event, url) => {
  pushGeneralLog(mainWindow, {
    level: 'info',
    source: 'nexus',
    message: 'NXM link received from OS open-url event',
    details: describeNxmUrl(url),
  })
  enqueueOrSendNxmUrl(url)
})

function resolveWindowIconPath(): string {
  if (process.platform === 'win32') {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'resources', 'icon.png')
    }

    return path.join(app.getAppPath(), 'build', 'icon.ico')
  }

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', 'icon.png')
  }

  return path.join(app.getAppPath(), 'src', 'main', 'resources', 'icon.png')
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getInitialMainWindowBounds(): {
  width: number
  height: number
  minWidth: number
  minHeight: number
  x: number
  y: number
} {
  const display = screen.getPrimaryDisplay()
  const { x, y, width: workWidth, height: workHeight } = display.workArea

  const maxWidth = Math.max(1100, workWidth - 96)
  const maxHeight = Math.max(720, workHeight - 72)
  const width = clampNumber(Math.round(workWidth * 0.82), Math.min(1360, maxWidth), maxWidth)
  const height = clampNumber(Math.round(workHeight * 0.84), Math.min(860, maxHeight), maxHeight)

  return {
    width,
    height,
    minWidth: Math.min(1100, maxWidth),
    minHeight: Math.min(720, maxHeight),
    x: x + Math.round((workWidth - width) / 2),
    y: y + Math.round((workHeight - height) / 2),
  }
}

function createMainWindow(): BrowserWindow {
  const bounds = getInitialMainWindowBounds()
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: bounds.minWidth,
    minHeight: bounds.minHeight,
    x: bounds.x,
    y: bounds.y,
    show: false,
    frame: false,
    title: 'Hyperion',
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    icon: resolveWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  attachEditContextMenu(win)

  return win
}

// Native Cut/Copy/Paste/Select All menu for editable fields and selected text
// (Electron does not show one by default). Enables right-click copy/paste in
// inputs such as the Nexus API key field.
function attachEditContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    const isEditable = params.isEditable
    const hasSelection = params.selectionText.trim().length > 0
    if (!isEditable && !hasSelection) return

    const canPaste = clipboard.readText().length > 0
    const template: Electron.MenuItemConstructorOptions[] = []

    if (isEditable) {
      template.push({ role: 'cut', enabled: hasSelection })
    }
    template.push({ role: 'copy', enabled: hasSelection })
    if (isEditable) {
      template.push({ role: 'paste', enabled: canPaste })
    }
    template.push({ type: 'separator' }, { role: 'selectAll' })

    Menu.buildFromTemplate(template).popup({ window: win })
  })
}

function registerGlobalHandlers(): void {
  // Settings
  ipcMain.handle(IPC.GET_SETTINGS, () => loadSettings())
  ipcMain.handle(IPC.GET_PATH_DEFAULTS, () => getPathDefaults())
  ipcMain.handle(IPC.ENSURE_DIRECTORY, (_event, targetPath: string) => {
    const resolvedPath = targetPath?.trim()
    if (!resolvedPath) return { ok: false, error: 'Path not provided' }
    try {
      fs.mkdirSync(resolvedPath, { recursive: true })
      return { ok: true }
    } catch (error) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'filesystem',
        message: 'Directory creation failed',
        details: error instanceof Error
          ? { targetPath: resolvedPath, error: error.message }
          : { targetPath: resolvedPath, error: String(error) },
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not create folder',
      }
    }
  })
  ipcMain.handle(IPC.SET_SETTINGS, (_event, settings) => {
    try {
      saveSettings(settings)

      if (settings.gamePath?.trim() && !isValidConfiguredGamePath(settings.gamePath)) {
        pushGeneralLog(mainWindow, {
          level: 'warn',
          source: 'settings',
          message: 'Game path invalid',
          details: { gamePath: settings.gamePath },
        })
      }

      if (settings.downloadPath?.trim() && !isUsableDirectoryPath(settings.downloadPath)) {
        pushGeneralLog(mainWindow, {
          level: 'warn',
          source: 'settings',
          message: 'Downloads path invalid',
          details: { downloadPath: settings.downloadPath },
        })
      }

      return { ok: true }
    } catch (error) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'filesystem',
        message: 'Settings save failed',
        details: error instanceof Error ? { error: error.message } : { error: String(error) },
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not save settings',
      }
    }
  })

  // File dialogs
  ipcMain.handle(IPC.OPEN_FILE_DIALOG, async (_event, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(mainWindow!, options)
    return result
  })

  ipcMain.handle(IPC.OPEN_FOLDER_DIALOG, async (_event, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      ...options,
      properties: ['openDirectory']
    })
    return result
  })

  ipcMain.handle(IPC.LIST_DOWNLOADS, () => {
    const settings = loadSettings()
    if (!settings.downloadPath) return { ok: true, data: [] }
    if (!isUsableDirectoryPath(settings.downloadPath)) {
      pushGeneralLog(mainWindow, {
        level: 'warn',
        source: 'downloads',
        message: 'Downloads path invalid',
        details: { downloadPath: settings.downloadPath },
      })
      return { ok: false, error: 'Downloads path is invalid' }
    }
    try {
      return { ok: true, data: collectDownloadEntries(settings.downloadPath) }
    } catch (error) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'filesystem',
        message: 'Downloads folder read failed',
        details: error instanceof Error
          ? { downloadPath: settings.downloadPath, error: error.message }
          : { downloadPath: settings.downloadPath, error: String(error) },
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not read downloads folder'
      }
    }
  })

  ipcMain.handle(IPC.DELETE_DOWNLOAD, (_event, downloadPath: string) => {
    try {
      if (!downloadPath || !fs.existsSync(downloadPath)) {
        return { ok: false, error: 'Download file not found' }
      }

      fs.rmSync(downloadPath, { force: true })
      removeNexusDownloadRecordByPath(downloadPath)
      return { ok: true }
    } catch (error) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'filesystem',
        message: 'Download delete failed',
        details: error instanceof Error
          ? { downloadPath, error: error.message }
          : { downloadPath, error: String(error) },
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not delete download file'
      }
    }
  })

  ipcMain.handle(IPC.DELETE_ALL_DOWNLOADS, () => {
    const settings = loadSettings()
    if (!settings.downloadPath) return { ok: false, error: 'Downloads path not configured' }
    if (!isUsableDirectoryPath(settings.downloadPath)) {
      return { ok: false, error: 'Downloads path is invalid' }
    }

    try {
      const entries = collectDownloadEntries(settings.downloadPath)
      let removed = 0
      let failed = 0
      const failures: Array<{ path: string; error: string }> = []

      for (const entry of entries) {
        try {
          fs.rmSync(entry.path, { force: true })
          removeNexusDownloadRecordByPath(entry.path)
          removed += 1
        } catch (error) {
          failed += 1
          failures.push({
            path: entry.path,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (failures.length > 0) {
        pushGeneralLog(mainWindow, {
          level: 'warn',
          source: 'filesystem',
          message: 'Some downloads could not be deleted',
          details: { failures },
        })
      }

      return { ok: true, data: { removed, failed } }
    } catch (error) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'filesystem',
        message: 'Delete all downloads failed',
        details: error instanceof Error
          ? { downloadPath: settings.downloadPath, error: error.message }
          : { downloadPath: settings.downloadPath, error: String(error) },
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not delete downloads',
      }
    }
  })

  // Shell
  ipcMain.handle(IPC.OPEN_PATH, async (_event, targetPath: string) => {
    if (!targetPath) return { ok: false, error: 'Path not provided' }
    const errorMessage = await shell.openPath(targetPath)
    if (errorMessage) {
      return { ok: false, error: errorMessage }
    }
    return { ok: true }
  })

  ipcMain.handle(IPC.SHOW_ITEM_IN_FOLDER, (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(IPC.OPEN_EXTERNAL, (_event, url: string) => {
    // Only allow https:// URLs for security
    if (url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  ipcMain.handle(IPC.GET_VFS_OVERWRITE_INFO, () => {
    try {
      return { ok: true, data: collectVfsOverwriteInfo() }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not read VFS overwrite folder',
      }
    }
  })

  ipcMain.handle(IPC.OPEN_VFS_OVERWRITE, async () => {
    try {
      const overwritePath = ensureVfsOverwritePath()
      const errorMessage = await shell.openPath(overwritePath)
      if (errorMessage) return { ok: false, error: errorMessage }
      return { ok: true, data: collectVfsOverwriteInfo() }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not open VFS overwrite folder',
      }
    }
  })

  ipcMain.handle(IPC.CLEAR_VFS_OVERWRITE, async () => {
    if (vfsMounted || await isGameProcessRunning()) {
      return { ok: false, error: 'Close Cyberpunk 2077 before clearing the VFS overwrite folder' }
    }

    const result = clearVfsOverwrite()
    if (!result.ok) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'launcher',
        message: 'VFS overwrite clear failed',
        details: { error: result.error, overwritePath: getVfsOverwritePath() },
      })
    }
    return result
  })

  ipcMain.handle(IPC.CANCEL_GAME_LAUNCH, () => {
    vfsLaunchCancelRequested = true
    appendVfsLaunchLog('vfs launch cancellation requested')
    return { ok: true }
  })

  ipcMain.handle(IPC.LAUNCH_GAME, async () => {
    vfsLaunchCancelRequested = false
    const settings = loadSettings()
    if (!settings.gamePath) return { ok: false, error: 'Game path not configured' }

    const gameRoot = resolveGameRootPath(settings.gamePath)
    const launchTarget = resolveGameExecutable(settings.gamePath)
    if (!fs.existsSync(launchTarget)) {
      return { ok: false, error: `Executable not found: ${launchTarget}` }
    }

    const launchDir = path.dirname(launchTarget)
    const emitLaunchProgress = (progress: GameLaunchProgress): void => {
      safeSendToWindow(mainWindow, IPC.LAUNCH_GAME_PROGRESS, {
        state: 'running',
        cancellable: true,
        logPath: getVfsLaunchLogPath(),
        ...progress,
      })
    }
    const finishCancelledLaunch = (percent: number): { ok: boolean; cancelled: boolean; error: string } => {
      unmountVfsIfMounted()
      cleanupStagedBootstrapFiles()
      appendVfsLaunchLog('vfs launch cancelled', { percent })
      emitLaunchProgress({
        step: 'Launch cancelled',
        percent,
        state: 'cancelled',
        cancellable: false,
        detail: 'VFS preparation was cancelled before the game was launched.',
      })
      return { ok: false, cancelled: true, error: 'Launch cancelled' }
    }
    const cancelledLaunchResult = (percent: number): { ok: boolean; cancelled: boolean; error: string } | null => {
      return vfsLaunchCancelRequested ? finishCancelledLaunch(percent) : null
    }
    const launchDirect = (reason: string, details?: unknown): { ok: boolean; error?: string } => {
      appendVfsLaunchLog('direct launch', { reason, details })
      try {
        emitLaunchProgress({
          step: 'Launching game',
          percent: 88,
          cancellable: false,
          detail: reason,
        })
        const child = spawn(launchTarget, [], {
          detached: true,
          stdio: 'ignore',
          cwd: launchDir,
          env: process.env,
        })
        child.unref()
        pushGeneralLog(mainWindow, {
          level: 'info',
          source: 'launcher',
          message: 'Game launched without VFS',
          details: { reason, launchTarget },
        })
        emitLaunchProgress({
          step: 'Game launched',
          percent: 100,
          state: 'done',
          cancellable: false,
          detail: 'No enabled VFS mods were found.',
        })
        return { ok: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        appendVfsLaunchLog('direct launch failed', { error: message, launchTarget })
        pushGeneralLog(mainWindow, {
          level: 'error',
          source: 'launcher',
          message: 'Game launch failed',
          details: { launchTarget, error: message },
        })
        emitLaunchProgress({
          step: 'Launch failed',
          percent: 100,
          state: 'error',
          cancellable: false,
          detail: message,
        })
        return { ok: false, error: message }
      }
    }

    // For Steam installs, make the game's embedded Steamworks SDK register with the
    // running Steam client (overlay, playtime, achievements) even though we launch the
    // exe directly. Two complementary mechanisms — this is how Vortex/MO2 stay tracked:
    //   1. steam_appid.txt next to the exe — the documented requirement when SteamAPI_Init
    //      runs outside the Steam client.
    //   2. SteamAppId / SteamGameId env vars — what Steam itself sets when launching a game.
    // Cyberpunk 2077 Steam App ID: 1091500
    const STEAM_APP_ID = '1091500'
    const normalizedGamePath = path.normalize(gameRoot || settings.gamePath).toLowerCase()
    const isSteamInstall = normalizedGamePath.includes('steamapps')

    if (isSteamInstall) {
      // Set on process.env so both the VFS-hooked child (which inherits the
      // controller's environment) and the fallback spawn pick these up.
      process.env.SteamAppId = STEAM_APP_ID
      process.env.SteamGameId = STEAM_APP_ID
      try {
        fs.writeFileSync(path.join(launchDir, 'steam_appid.txt'), STEAM_APP_ID, 'utf8')
      } catch {
        // Non-fatal: the env vars alone may still register the game with Steam.
      }
    }

    try {
      emitLaunchProgress({
        step: 'Scanning enabled mods',
        percent: 10,
        detail: settings.libraryPath ?? 'No library path configured',
      })
      const mods = settings.libraryPath ? await scanMods(settings.libraryPath) : []
      const enabledMods = mods.filter((mod) => mod.kind === 'mod' && mod.enabled)
      const scanCancelled = cancelledLaunchResult(18)
      if (scanCancelled) return scanCancelled

      emitLaunchProgress({
        step: 'Building VFS map',
        percent: 26,
        current: enabledMods.length,
        total: mods.filter((mod) => mod.kind === 'mod').length,
        detail: `${enabledMods.length} enabled mod(s)`,
      })
      let links: VfsLink[] = settings.libraryPath
        ? await buildEnabledModLinks(gameRoot, settings.libraryPath, mods)
        : []
      const mapCancelled = cancelledLaunchResult(38)
      if (mapCancelled) return mapCancelled

      emitLaunchProgress({
        step: 'Loading usvfs bridge',
        percent: 46,
        current: links.length,
        total: Math.max(links.length, 1),
        detail: `${links.length} VFS link(s) planned`,
      })
      const bridge = loadVfsBridge()
      const bridgeDiagnostics = getVfsBridgeDiagnostics()

      appendVfsLaunchLog('launch requested', {
        appVersion: app.getVersion(),
        packaged: app.isPackaged,
        gamePath: settings.gamePath,
        gameRoot,
        launchTarget,
        launchDir,
        libraryPath: settings.libraryPath,
        bridge: bridgeDiagnostics,
        enabledMods: enabledMods.map((mod) => ({
          name: mod.name,
          folderName: mod.folderName,
          type: mod.type,
          order: mod.order,
          fileCount: Array.isArray(mod.files) ? mod.files.length : 0,
          sampleFiles: Array.isArray(mod.files) ? mod.files.slice(0, 20) : [],
        })),
      })

      appendVfsLaunchLog('vfs link plan', {
        linkCount: links.length,
        links: links.slice(0, 200),
        truncatedLinks: Math.max(0, links.length - 200),
      })

      if (enabledMods.length === 0 || links.length === 0) {
        if (enabledMods.length > 0) {
          const error = makeVfsLaunchError('No VFS links were generated for the enabled mods')
          appendVfsLaunchLog('vfs link plan failed', { enabledModCount: enabledMods.length })
          emitLaunchProgress({
            step: 'VFS map failed',
            percent: 100,
            state: 'error',
            cancellable: false,
            detail: error,
          })
          pushGeneralLog(mainWindow, {
            level: 'error',
            source: 'launcher',
            message: 'No VFS links generated for enabled mods',
            details: { enabledModCount: enabledMods.length, logPath: getVfsLaunchLogPath() },
          })
          return { ok: false, error }
        }
        cleanupStagedBootstrapFiles()
        return launchDirect('No enabled mods')
      }

      if (!bridge) {
        const error = makeVfsLaunchError('VFS bridge unavailable; enabled mods would not be visible in game')
        appendVfsLaunchLog('vfs bridge unavailable', bridgeDiagnostics)
        emitLaunchProgress({
          step: 'usvfs bridge unavailable',
          percent: 100,
          state: 'error',
          cancellable: false,
          detail: error,
        })
        pushGeneralLog(mainWindow, {
          level: 'error',
          source: 'launcher',
          message: 'VFS bridge unavailable',
          details: { ...bridgeDiagnostics, logPath: getVfsLaunchLogPath() },
        })
        return { ok: false, error }
      }

      if (settings.libraryPath) {
        emitLaunchProgress({
          step: 'Preparing overwrite layer',
          percent: 54,
          detail: 'Moving runtime files out of the game folder',
        })
        const residueMigration = migrateVfsPhysicalResidue(gameRoot, settings.libraryPath, enabledMods)
        const residueErrors = residueMigration.filter((entry) => entry.status === 'error')
        appendVfsLaunchLog('vfs physical residue migration result', {
          migrated: residueMigration.filter((entry) => entry.status === 'migrated').length,
          errors: residueErrors.length,
          entries: residueMigration,
        })
        if (residueErrors.length > 0) {
          pushGeneralLog(mainWindow, {
            level: 'warn',
            source: 'launcher',
            message: 'Some physical VFS residue could not be moved to overwrite',
            details: { entries: residueErrors, logPath: getVfsLaunchLogPath() },
          })
        }
      }

      emitLaunchProgress({
        step: 'Preparing bootstrap files',
        percent: 58,
        detail: 'Staging import-time loader files when needed',
      })
      const bootstrapStage = settings.libraryPath
        ? stageVfsBootstrapFiles(gameRoot, settings.libraryPath, enabledMods)
        : { ok: true, entries: [], tempDirs: [] }
      appendVfsLaunchLog('vfs bootstrap staging result', bootstrapStage)
      stagedBootstrapEntries = bootstrapStage.entries.filter((entry) => entry.status === 'copied')
      stagedBootstrapTempDirs = bootstrapStage.tempDirs
      const bootstrapCancelled = cancelledLaunchResult(64)
      if (bootstrapCancelled) return bootstrapCancelled
      if (!bootstrapStage.ok) {
        cleanupStagedBootstrapFiles()
        const error = makeVfsLaunchError(bootstrapStage.error ?? 'VFS bootstrap staging failed')
        emitLaunchProgress({
          step: 'Bootstrap staging failed',
          percent: 100,
          state: 'error',
          cancellable: false,
          detail: error,
        })
        pushGeneralLog(mainWindow, {
          level: 'error',
          source: 'launcher',
          message: 'VFS bootstrap staging failed',
          details: { ...bootstrapStage, logPath: getVfsLaunchLogPath() },
        })
        return { ok: false, error }
      }

      const bootstrapOverrides = createBootstrapOverrideLinks(bootstrapStage.entries)
      stagedBootstrapOverrideDirs = bootstrapOverrides.dirs
      if (bootstrapOverrides.links.length > 0) {
        links = [...links, ...bootstrapOverrides.links]
        appendVfsLaunchLog('vfs bootstrap override links', {
          linkCount: bootstrapOverrides.links.length,
          links: bootstrapOverrides.links,
        })
      }

      const keptBootstrapFiles = bootstrapStage.entries.filter((entry) => entry.status === 'existing-kept')
      if (keptBootstrapFiles.length > 0) {
        pushGeneralLog(mainWindow, {
          level: 'warn',
          source: 'launcher',
          message: 'Existing physical bootstrap files were kept',
          details: { entries: keptBootstrapFiles, logPath: getVfsLaunchLogPath() },
        })
      }

      // Writable overwrite layer: a real folder set as the create-target for the
      // game root, so mods/the game can create or write files inside otherwise
      // read-only virtual folders (e.g. red4ext/logs, red4ext/config.ini,
      // r6/cache). Without it, anything that writes at runtime (RED4ext,
      // redscript) crashes; archive-only mods are unaffected because they are
      // read-only. Persisted across launches so caches/configs survive.
      const overwriteDir = ensureVfsOverwritePath(settings.libraryPath)
      try {
        const cleanResult = cleanVfsOverwriteVolatileFiles(overwriteDir)
        if (cleanResult.removed > 0 || cleanResult.errors.length > 0) {
          appendVfsLaunchLog('vfs overwrite pre-launch volatile cleanup result', cleanResult)
        }

        const overwriteReadLinks = buildVfsOverwriteReadLinks(gameRoot, overwriteDir)
        links = [...links, { source: overwriteDir, dest: gameRoot, dir: true, createTarget: true }]
        if (overwriteReadLinks.length > 0) {
          links = [...links, ...overwriteReadLinks]
        }
        appendVfsLaunchLog('vfs overwrite layer', {
          overwriteDir,
          dest: gameRoot,
          readOverlayFiles: overwriteReadLinks.length,
          sampleReadOverlayFiles: overwriteReadLinks.slice(0, 30),
        })
      } catch (err: unknown) {
        appendVfsLaunchLog('vfs overwrite layer failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }

      emitLaunchProgress({
        step: 'Mounting usvfs',
        percent: 74,
        current: links.length,
        total: Math.max(links.length, 1),
        detail: `${bootstrapStage.entries.length} bootstrap file(s), ${links.length} VFS link(s)`,
      })
      const mount = bridge.mountVfs({
        instanceName: 'hyperion',
        links,
        blacklistExecutables: USVFS_AUXILIARY_PROCESS_BLACKLIST,
      })
      appendVfsLaunchLog('vfs mount result', {
        ...mount,
        blacklistExecutables: USVFS_AUXILIARY_PROCESS_BLACKLIST,
      })
      if (!mount.ok) {
        cleanupStagedBootstrapFiles()
        const error = makeVfsLaunchError(`VFS mount failed at ${mount.stage ?? 'unknown stage'}`)
        emitLaunchProgress({
          step: 'VFS mount failed',
          percent: 100,
          state: 'error',
          cancellable: false,
          detail: error,
        })
        pushGeneralLog(mainWindow, {
          level: 'error',
          source: 'launcher',
          message: 'VFS mount failed',
          details: { ...mount, logPath: getVfsLaunchLogPath() },
        })
        return { ok: false, error }
      }

      vfsMounted = true
      activeVfsLaunchContext = settings.libraryPath
        ? { gameRoot, libraryPath: settings.libraryPath, enabledMods }
        : null
      const mountCancelled = cancelledLaunchResult(82)
      if (mountCancelled) return mountCancelled

      if ((mount.linked ?? 0) === 0) {
        unmountVfsIfMounted()
        const error = makeVfsLaunchError('VFS mounted but no links were accepted')
        appendVfsLaunchLog('vfs mount accepted no links', mount)
        emitLaunchProgress({
          step: 'VFS mount accepted no links',
          percent: 100,
          state: 'error',
          cancellable: false,
          detail: error,
        })
        pushGeneralLog(mainWindow, {
          level: 'error',
          source: 'launcher',
          message: 'VFS mounted with zero linked paths',
          details: { ...mount, requestedLinks: links.length, logPath: getVfsLaunchLogPath() },
        })
        return { ok: false, error }
      }

      if ((mount.failed ?? 0) > 0) {
        pushGeneralLog(mainWindow, {
          level: 'warn',
          source: 'launcher',
          message: 'Some VFS links failed',
          details: { ...mount, requestedLinks: links.length, logPath: getVfsLaunchLogPath() },
        })
      }

      try {
        const dump = bridge.dumpVfsTree?.()
        appendVfsLaunchLog('vfs tree dump', {
          dump: dump ? dump.slice(0, 30000) : '(unavailable)',
          truncated: Boolean(dump && dump.length > 30000),
        })
      } catch (error) {
        appendVfsLaunchLog('vfs tree dump failed', error)
      }

      emitLaunchProgress({
        step: 'Launching Cyberpunk2077.exe',
        percent: 92,
        state: 'running',
        cancellable: false,
        detail: `${mount.linked ?? 0} VFS link(s) mounted`,
      })
      const launch = bridge.launchHookedProcess({
        appPath: launchTarget,
        commandLine: `"${launchTarget}"`,
        cwd: launchDir,
        capture: false,
        waitMs: 0,
      })
      appendVfsLaunchLog('hooked launch result', launch)

      if (!launch.ok) {
        unmountVfsIfMounted()
        const error = makeVfsLaunchError(`VFS hooked launch failed at ${launch.stage ?? 'unknown stage'}`)
        emitLaunchProgress({
          step: 'Hooked launch failed',
          percent: 100,
          state: 'error',
          cancellable: false,
          detail: error,
        })
        pushGeneralLog(mainWindow, {
          level: 'error',
          source: 'launcher',
          message: 'VFS hooked launch failed',
          details: { ...launch, logPath: getVfsLaunchLogPath() },
        })
        return { ok: false, error }
      }

      const expectedBootstrapModules = getExpectedBootstrapModuleNames(bootstrapStage.entries)
      setTimeout(() => {
        try {
          const procs = bridge.vfsProcesses?.() ?? []
          void Promise.all([isGameProcessRunning(), getGameModuleSnapshot()]).then(([gameRunningNow, modules]) => {
            const expectedModuleSet = new Set(expectedBootstrapModules)
            const loadedExpectedModules = new Set(
              modules
                .map((entry) => entry.module?.toLowerCase())
                .filter((moduleName): moduleName is string =>
                  typeof moduleName === 'string' && expectedModuleSet.has(moduleName)
                )
            )
            const missingBootstrapModules = expectedBootstrapModules.filter((moduleName) => !loadedExpectedModules.has(moduleName))
            const expectedModulesLoadedOutsideSystem = new Set(
              modules
                .filter((entry) => {
                  const moduleName = entry.module?.toLowerCase()
                  return typeof moduleName === 'string'
                    && expectedModuleSet.has(moduleName)
                    && !isWindowsSystemModulePath(entry.path)
                })
                .map((entry) => entry.module?.toLowerCase())
                .filter((moduleName): moduleName is string => typeof moduleName === 'string')
            )
            const systemResolvedBootstrapModules = modules.filter((entry) => {
              const moduleName = entry.module?.toLowerCase()
              return typeof moduleName === 'string'
                && expectedModuleSet.has(moduleName)
                && isWindowsSystemModulePath(entry.path)
                && !expectedModulesLoadedOutsideSystem.has(moduleName)
            })
            const interestingModules = modules.filter((entry) => {
              const moduleName = entry.module?.toLowerCase()
              if (moduleName && expectedModuleSet.has(moduleName)) return true
              if (moduleName && /\.(asi)$/i.test(moduleName)) return true
              return Boolean(entry.path && path.normalize(entry.path).toLowerCase().startsWith(gameRoot.toLowerCase()))
            })
            appendVfsLaunchLog('vfs process check after 12s', {
              launchedPid: launch.pid,
              vfsProcesses: procs,
              gameRunning: gameRunningNow,
              expectedBootstrapModules,
              moduleCount: modules.length,
              modules: interestingModules,
            })
            if (gameRunningNow && procs.length === 0) {
              pushGeneralLog(mainWindow, {
                level: 'warn',
                source: 'launcher',
                message: 'Game is running but no process is attached to the VFS',
                details: { launchedPid: launch.pid, logPath: getVfsLaunchLogPath() },
              })
            }
            if (gameRunningNow && systemResolvedBootstrapModules.length > 0) {
              pushGeneralLog(mainWindow, {
                level: 'warn',
                source: 'launcher',
                message: 'Game loaded a Windows system DLL instead of a staged bootstrap module',
                details: {
                  modules: systemResolvedBootstrapModules,
                  expectedBootstrapModules,
                  logPath: getVfsLaunchLogPath(),
                },
              })
            }
            if (gameRunningNow && missingBootstrapModules.length > 0) {
              pushGeneralLog(mainWindow, {
                level: 'warn',
                source: 'launcher',
                message: 'Expected bootstrap modules were not loaded',
                details: {
                  missingBootstrapModules,
                  expectedBootstrapModules,
                  modules: interestingModules,
                  logPath: getVfsLaunchLogPath(),
                },
              })
            }
          })
        } catch (error) {
          appendVfsLaunchLog('vfs process check failed', error)
        }
      }, 12000)

      pushGeneralLog(mainWindow, {
        level: 'info',
        source: 'launcher',
        message: 'Game launched through usvfs VFS',
        details: {
          linkedPaths: mount.linked,
          failedLinks: mount.failed,
          requestedLinks: links.length,
          pid: launch.pid,
          logPath: getVfsLaunchLogPath(),
        },
      })
      emitLaunchProgress({
        step: 'Game launched through usvfs',
        percent: 100,
        state: 'done',
        cancellable: false,
        detail: `PID ${launch.pid ?? 'unknown'} attached to VFS`,
      })
      startGameExitMonitor(launch.pid)
      return { ok: true }
    } catch (err: unknown) {
      unmountVfsIfMounted()
      const message = err instanceof Error ? err.message : String(err)
      appendVfsLaunchLog('vfs launch path errored', { error: message })
      emitLaunchProgress({
        step: 'VFS launch failed',
        percent: 100,
        state: 'error',
        cancellable: false,
        detail: message,
      })
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'launcher',
        message: 'VFS launch path errored',
        details: { error: message, logPath: getVfsLaunchLogPath() },
      })
      return { ok: false, error: makeVfsLaunchError(message) }
    }
  })

  ipcMain.handle(IPC.GAME_RUNNING, (): Promise<boolean> => {
    return new Promise((resolve) => {
      exec('tasklist /FI "IMAGENAME eq Cyberpunk2077.exe" /NH /FO CSV', (err, stdout) => {
        resolve(!err && stdout.includes('"Cyberpunk2077.exe"'))
      })
    })
  })

  ipcMain.handle(IPC.KILL_GAME, (): Promise<{ ok: boolean }> => {
    return new Promise((resolve) => {
      exec('taskkill /F /IM Cyberpunk2077.exe /T', (err) => {
        // Wait for the process to fully release file handles before running
        // residue migration — taskkill completes before the OS fully tears
        // down the process, so an immediate unmount races with locked files.
        setTimeout(() => {
          unmountVfsIfMounted()
          resolve({ ok: !err })
        }, 1500)
      })
    })
  })

  // Read a local image file and return it as a base64 data URL so the renderer
  // can display FOMOD preview images without any protocol-scheme restrictions.
  ipcMain.handle(IPC.FOMOD_READ_IMAGE, (_event, filePath: string): string => {
    if (!filePath || typeof filePath !== 'string') return ''
    try {
      const data = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mime = (
        { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' } as Record<string, string>
      )[ext] ?? 'image/png'
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC.GET_APP_VERSION, () => app.getVersion())
  ipcMain.handle(IPC.APP_LOGS_GET, () => ({ ok: true, data: getAppLogsSnapshot() }))
  ipcMain.handle(IPC.APP_LOGS_CLEAR, (_event, kind: 'general' | 'requests' | 'all' = 'all') => {
    clearAppLogs(kind)
    return { ok: true }
  })

  // Window controls (titlebar buttons)
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize()
  })
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => {
    mainWindow?.close()
  })
}

app.whenReady().then(async () => {
  // Show splash while loading
  const splash = createSplashWindow()
  let mainWindowReadyToShow = false
  let mainWindowRevealed = false

  const updateSplashStatus = (message: string) => {
    if (splash.isDestroyed()) return
    const serialized = JSON.stringify(message)
    splash.webContents.executeJavaScript(`
      const s = document.getElementById('status');
      if (s) s.textContent = ${serialized};
    `).catch(() => { /* splash element may not exist */ })
  }

  const revealMainWindow = () => {
    if (!rendererReady || !mainWindowReadyToShow || !mainWindow || mainWindowRevealed) return

    const targetWindow = mainWindow
    mainWindowRevealed = true

    if (targetWindow.isMinimized()) {
      targetWindow.restore()
    }

    targetWindow.setSkipTaskbar(false)
    targetWindow.show()
    targetWindow.moveTop()
    targetWindow.focus()
    targetWindow.webContents.focus()

    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.moveTop()
      mainWindow.focus()
      mainWindow.webContents.focus()
    }, 120)

    if (!splash.isDestroyed()) {
      splash.hide()
      splash.setAlwaysOnTop(false)
      setTimeout(() => {
        if (!splash.isDestroyed()) splash.destroy()
      }, 0)
    }

    flushPendingNxmUrls()
  }

  splash.webContents.on('did-finish-load', () => {
    updateSplashStatus('Loading settings...')
  })

  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('nxm')
  } else {
    // In dev mode pass the app path and -- so Electron doesn't treat the nxm:// URL as a module path
    app.setAsDefaultProtocolClient('nxm', process.execPath, [app.getAppPath(), '--'])
  }

  // Register all IPC handlers
  registerGlobalHandlers()
  registerModManagerHandlers(() => mainWindow)
  registerInstallerHandlers(() => mainWindow)
  registerGameDetectorHandlers()
  registerNexusDownloaderHandlers(() => mainWindow)

  // Load initial settings
  const settings = loadSettings()

  // Ensure library directory exists
  if (settings.libraryPath && !fs.existsSync(settings.libraryPath)) {
    fs.mkdirSync(settings.libraryPath, { recursive: true })
  }
  const cleanedInstallerTempDirs = cleanupInstallerTempDirs(settings)

  // Create main window (hidden)
  mainWindow = createMainWindow()
  pushGeneralLog(mainWindow, {
    level: 'info',
    source: 'app',
    message: 'App started',
    details: { packaged: app.isPackaged, version: app.getVersion(), cleanedInstallerTempDirs },
  })

  if (settings.gamePath?.trim() && !isValidConfiguredGamePath(settings.gamePath)) {
    pushGeneralLog(mainWindow, {
      level: 'warn',
      source: 'settings',
      message: 'Game path invalid',
      details: { gamePath: settings.gamePath },
    })
  }

  if (settings.downloadPath?.trim() && !isUsableDirectoryPath(settings.downloadPath)) {
    pushGeneralLog(mainWindow, {
      level: 'warn',
      source: 'settings',
      message: 'Downloads path invalid',
      details: { downloadPath: settings.downloadPath },
    })
  }

  mainWindow.once('ready-to-show', () => {
    mainWindowReadyToShow = true
    revealMainWindow()
  })

  // Initialize auto-updater and start the self-update check during the splash so the
  // header update button is ready by the time the window opens, instead of a few
  // seconds after the renderer boots.
  initializeUpdates(mainWindow)
  if (app.isPackaged && settings.autoUpdate) {
    void checkForUpdatesOnStartup()
  }

  // Reveal the main window only when Electron has a first paint ready and
  // the renderer explicitly signals that the boot sequence is complete.
  ipcMain.on(IPC.APP_BOOT_STATUS, (_event, message: string) => {
    updateSplashStatus(message)
  })

  ipcMain.once(IPC.APP_READY, () => {
    rendererReady = true
    flushPendingNxmUrls()
    // Deliver any update result that resolved during the splash, now that the
    // renderer's update listeners are guaranteed to be registered.
    flushCachedUpdateInfo()
    revealMainWindow()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  // Tear down any active VFS so usvfs shared state doesn't outlive the controller.
  unmountVfsIfMounted()
  try {
    cleanupInstallerTempDirs(loadSettings())
  } catch {
    // Best-effort shutdown cleanup only.
  }
  pushGeneralLog(mainWindow, {
    level: 'info',
    source: 'app',
    message: 'App shutting down',
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
