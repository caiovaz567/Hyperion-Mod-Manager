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
import os from 'os'
import crypto from 'crypto'
import { spawn, exec, execFile } from 'child_process'
import { getPathDefaults, loadSettings, saveSettings } from './settings'
import { createSplashWindow } from './splash'
import { initializeUpdates, checkForUpdatesOnStartup, flushCachedUpdateInfo } from './updater'
import {
  registerModManagerHandlers,
  buildEnabledModLinks,
  getDeployRelativePath,
  getRedmodFolderNames,
  modHasRedmodContent,
  normalizeRelativePath,
  scanMods,
} from './ipc/modManager'
import { getVfsBridgeDiagnostics, loadVfsBridge, type UsvfsBridge, type VfsLink } from './vfsBridge'
import { isLibraryWatchSuppressed } from './libraryWatchSuppress'
import { cleanupInstallerTempDirs, registerInstallerHandlers } from './ipc/installer'
import { registerGameDetectorHandlers } from './ipc/gameDetector'
import { registerNexusDownloaderHandlers } from './ipc/nexusDownloader'
import { IPC, type GameLaunchProgress, type ModMetadata, type ModUpdateCache, type VfsOverwriteInfo } from '../shared/types'
import { parseNxmUrl } from '../shared/nxm'
import { clearAppLogs, getAppLogsSnapshot, pushGeneralLog, safeSendToWindow } from './logStore'
import { findNexusDownloadRecordByPath, removeNexusDownloadRecordByPath } from './nexusDownloadRegistry'
import { loadModUpdateCache, saveModUpdateCache } from './modUpdateCache'

const DOWNLOAD_EXTENSIONS = new Set(['.zip', '.rar', '.7z'])
const GAME_EXECUTABLE_RELATIVE_PATH = path.join('bin', 'x64', 'Cyberpunk2077.exe')
const BOOTSTRAP_ROOT_EXTENSIONS = new Set(['.dll', '.asi', '.ini', '.cfg', '.toml', '.json'])
const BOOTSTRAP_PLUGIN_EXTENSIONS = new Set(['.dll', '.asi', '.ini', '.cfg', '.toml', '.json'])
const BOOTSTRAP_TEMP_DIR_MARKER = '.hyperion-vfs-bootstrap'
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
let vfsLaunchInProgress = false

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
    exec('tasklist /FI "IMAGENAME eq Cyberpunk2077.exe" /NH /FO CSV', { windowsHide: true }, (err, stdout) => {
      resolve(!err && stdout.includes('"Cyberpunk2077.exe"'))
    })
  })
}

function isProcessRunningByPid(pid?: number): Promise<boolean> {
  if (!pid || !Number.isFinite(pid)) return Promise.resolve(false)

  return new Promise((resolve) => {
    exec(`tasklist /FI "PID eq ${Math.trunc(pid)}" /NH /FO CSV`, { windowsHide: true }, (err, stdout) => {
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

  // usvfsVirtualLinkFile requires the destination's parent directory to exist at
  // least virtually (see usvfs.h). Many runtime captures live in directories that
  // are created at runtime and exist in NO enabled mod's source tree — e.g.
  // bin/x64/plugins/address_library, r6/storages/RedscriptConfigFramework,
  // red4ext/plugins/Codeware/Persistent. usvfsVirtualLinkDirectoryStatic only
  // materializes directories that exist in the source, so nothing materializes
  // those parents and the file link fails ("Some VFS links failed"), silently
  // dropping the captured file. Materialize each missing parent from an empty real
  // directory first, exactly like buildEnabledModLinks does for loose files.
  const emptyDir = path.join(os.tmpdir(), 'hyperion-vfs-empty')
  try { fs.mkdirSync(emptyDir, { recursive: true }) } catch { /* ignore */ }

  const resolvedGameRoot = path.resolve(gameRoot)
  const links: VfsLink[] = []
  const materializedDirs = new Set<string>()

  // Ensure every ancestor directory of `destDir` (up to the first one that exists
  // physically in the game tree) is materialized virtually, shallow-to-deep, so each
  // emptyDir link's own parent already exists when usvfs links it. Materializing only
  // the immediate parent is not enough when several levels are runtime-created (e.g.
  // r6/storages/RedscriptConfigFramework — both `storages` and the framework folder
  // are missing). usvfsVirtualLinkDirectoryStatic on an empty dir only ensures the
  // node exists; it never hides existing files because usvfs merges directory links.
  const materializeChain = (destDir: string): void => {
    const chain: string[] = []
    let cur = path.resolve(destDir)
    while (cur.length > resolvedGameRoot.length && cur.toLowerCase().startsWith(resolvedGameRoot.toLowerCase())) {
      if (fs.existsSync(cur)) break
      chain.push(cur)
      const parent = path.dirname(cur)
      if (parent === cur) break
      cur = parent
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const dir = chain[i]
      const dirKey = dir.toLowerCase()
      if (materializedDirs.has(dirKey)) continue
      materializedDirs.add(dirKey)
      links.push({ source: emptyDir, dest: dir, dir: true })
    }
  }

  for (const filePath of collectFilesRecursive(overwritePath)) {
    const relFile = normalizeRelativePath(path.relative(overwritePath, filePath))
    if (!relFile || isVolatileOverwriteFile(relFile)) continue

    const dest = path.join(gameRoot, relFile)
    materializeChain(path.dirname(dest))
    links.push({ source: filePath, dest, dir: false })
  }

  return links
}

// Removes ALL captured files inside the overwrite folder (keeping the folder
// itself). This backs the manual "Clear captures" action and is intentionally a
// full wipe — unlike cleanVfsOverwriteVolatileFiles, which only prunes volatile
// logs/tmp during automatic post-run cleanup and must not touch user settings.
function removeAllVfsOverwriteFiles(overwritePath: string): VfsOverwriteCleanResult {
  const result: VfsOverwriteCleanResult = { removed: 0, removedBytes: 0, errors: [] }
  if (!fs.existsSync(overwritePath)) {
    fs.mkdirSync(overwritePath, { recursive: true })
    return result
  }

  for (const filePath of collectFilesRecursive(overwritePath)) {
    try {
      result.removedBytes += fs.statSync(filePath).size
      result.removed += 1
    } catch {
      // Best-effort byte/count accounting; the re-scan below is the source of truth.
    }
  }

  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(overwritePath, { withFileTypes: true }) } catch { /* ignore */ }
  for (const entry of entries) {
    const entryPath = path.join(overwritePath, entry.name)
    try {
      fs.rmSync(entryPath, { recursive: true, force: true })
    } catch (error) {
      result.errors.push({
        path: entryPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  fs.mkdirSync(overwritePath, { recursive: true })
  return result
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

    const cleanResult = removeAllVfsOverwriteFiles(overwritePath)
    appendVfsLaunchLog('vfs overwrite cleared', { overwritePath, ...cleanResult })
    const info = collectVfsOverwriteInfo()
    if (info.fileCount > 0 && cleanResult.errors.length > 0) {
      return {
        ok: false,
        data: info,
        error: `Could not remove ${cleanResult.errors.length} item(s). Close Cyberpunk 2077 if it is running and try again.`,
      }
    }
    return { ok: true, data: info }
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
      .filter((relFile) => Boolean(relFile) && relFile !== '_metadata.json' && relFile !== '_archive_resources.json')

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
      .filter((relFile) => Boolean(relFile) && relFile !== '_metadata.json' && relFile !== '_archive_resources.json')

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
      markerPath: path.join(dir, BOOTSTRAP_TEMP_DIR_MARKER),
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

// ─── Bootstrap staging crash-recovery manifest ────────────────────────────────
// The staged-file lists above live in memory, so a crash (or a quit while the
// game is still attached to the VFS) would orphan the physically staged loader
// files in the game folder forever — cleanup only ever removes entries it staged
// itself ('copied'), and a later launch re-stages them as 'already-present'.
// Persisting the lists lets the next session replay the exact same cleanup.
interface BootstrapStagingManifest {
  savedAt?: string
  entries?: BootstrapStageEntry[]
  overrideDirs?: string[]
  tempDirs?: BootstrapTempDir[]
}

function getBootstrapStagingManifestPath(): string {
  return path.join(app.getPath('userData'), 'vfs-bootstrap-staged.json')
}

function readBootstrapStagingManifest(): BootstrapStagingManifest | null {
  try {
    const manifestPath = getBootstrapStagingManifestPath()
    if (!fs.existsSync(manifestPath)) return null
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BootstrapStagingManifest
  } catch {
    return null
  }
}

function removeBootstrapStagingManifest(): void {
  try {
    fs.rmSync(getBootstrapStagingManifestPath(), { force: true })
  } catch {
    // Best-effort bookkeeping; a stale manifest is re-validated before use.
  }
}

function persistBootstrapStagingManifest(): void {
  try {
    if (
      stagedBootstrapEntries.length === 0
      && stagedBootstrapOverrideDirs.length === 0
      && stagedBootstrapTempDirs.length === 0
    ) {
      removeBootstrapStagingManifest()
      return
    }
    fs.writeFileSync(
      getBootstrapStagingManifestPath(),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        entries: stagedBootstrapEntries,
        overrideDirs: stagedBootstrapOverrideDirs,
        tempDirs: stagedBootstrapTempDirs,
      } satisfies BootstrapStagingManifest, null, 2),
      'utf8'
    )
  } catch {
    // Crash-recovery bookkeeping must never block a launch.
  }
}

// Merge staging left by a previous session (from the manifest) with this run's
// fresh staging. Keyed on dest so a re-staged file keeps its newest entry; only
// 'copied' entries matter — cleanup ignores every other status.
function mergeStagedBootstrapEntries(
  previous: BootstrapStageEntry[] | undefined,
  current: BootstrapStageEntry[]
): BootstrapStageEntry[] {
  const byDest = new Map<string, BootstrapStageEntry>()
  for (const entry of [...(previous ?? []), ...current]) {
    if (entry?.status !== 'copied' || !entry.dest) continue
    byDest.set(pathKey(entry.dest), entry)
  }
  return [...byDest.values()]
}

function mergeStagedTempDirs(
  previous: BootstrapTempDir[] | undefined,
  current: BootstrapTempDir[]
): BootstrapTempDir[] {
  const byDir = new Map<string, BootstrapTempDir>()
  for (const tempDir of [...(previous ?? []), ...current]) {
    if (!tempDir?.dir || !tempDir.markerPath) continue
    byDir.set(pathKey(tempDir.dir), tempDir)
  }
  return [...byDir.values()]
}

// Replays the bootstrap cleanup a previous session never got to run (crash, kill,
// or quit while the game was attached to the VFS). Runs once at startup; while
// the game is running it defers — the next launch folds the leftover manifest
// into its own staging lists instead.
async function sweepLeftoverBootstrapStaging(): Promise<void> {
  const manifest = readBootstrapStagingManifest()
  if (!manifest) return
  if (vfsLaunchInProgress || vfsMounted) return
  if (await isGameProcessRunning()) {
    appendVfsLaunchLog('leftover bootstrap staging sweep deferred: game is running', {
      entries: manifest.entries?.length ?? 0,
    })
    return
  }
  if (vfsLaunchInProgress || vfsMounted) return

  stagedBootstrapEntries = mergeStagedBootstrapEntries(manifest.entries, [])
  stagedBootstrapTempDirs = mergeStagedTempDirs(manifest.tempDirs, [])
  stagedBootstrapOverrideDirs = [...new Set(manifest.overrideDirs ?? [])]
  appendVfsLaunchLog('sweeping leftover bootstrap staging from a previous session', {
    entries: stagedBootstrapEntries.length,
    tempDirs: stagedBootstrapTempDirs.length,
    overrideDirs: stagedBootstrapOverrideDirs.length,
  })
  cleanupStagedBootstrapFiles()
}

function cleanupStagedBootstrapFiles(): void {
  if (
    stagedBootstrapEntries.length === 0
    && stagedBootstrapOverrideDirs.length === 0
    && stagedBootstrapTempDirs.length === 0
  ) {
    removeBootstrapStagingManifest()
    return
  }

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

  removeBootstrapStagingManifest()
  appendVfsLaunchLog('vfs bootstrap cleanup result', {
    entries: results,
    tempDirs: tempDirResults,
    overrides: overrideResults,
  })
}

function makeVfsLaunchError(message: string): string {
  return `${message}. See ${getVfsLaunchLogPath()}`
}

// ─── REDmod deploy (virtual) ─────────────────────────────────────────────────
// REDmods don't load by merely existing under `mods/` — the game only sees them
// after `tools/redmod/bin/redMod.exe deploy` compiles scripts/tweaks/sounds into
// `r6/cache/modded`, and only when launched with `-modded`. Hyperion runs that
// deploy as a VFS-HOOKED process AFTER mounting: redMod reads the *virtual* mods/
// tree (enabled REDmods mapped from the library) and its writes to r6/cache/modded
// are redirected into the Runtime Captures overwrite folder — the real game dir
// stays clean. The compiled output is remounted as read overlays on later launches,
// and a fingerprint of the enabled REDmod set skips the (slow) deploy when nothing
// changed. On any failure the launch continues WITHOUT -modded so non-REDmod mods
// still work.
const REDMOD_DEPLOY_TIMEOUT_MS = 8 * 60_000
// Tight poll: this is also the cancel-latency ceiling for the Cancel button.
const REDMOD_DEPLOY_POLL_MS = 300

interface RedmodDeployOutcome {
  modded: boolean
  skipped?: boolean
  cancelled?: boolean
  failed?: string
}

function getRedmodToolPath(gameRoot: string): string {
  return path.join(gameRoot, 'tools', 'redmod', 'bin', 'redMod.exe')
}

function getRedmodDeployStatePath(): string {
  return path.join(app.getPath('userData'), 'redmod-deploy-state.json')
}

function readRedmodDeployState(): { fingerprint?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(getRedmodDeployStatePath(), 'utf8')) as { fingerprint?: string }
  } catch {
    return null
  }
}

function writeRedmodDeployState(state: { fingerprint: string; deployedAt: string }): void {
  try {
    fs.writeFileSync(getRedmodDeployStatePath(), JSON.stringify(state, null, 2), 'utf8')
  } catch {
    // Losing the state only means an extra redeploy next launch.
  }
}

// Identity of the enabled REDmod set: which mods, whether their payload changed
// (size/count/source timestamps), and the resolved `-mod=` load order — a pure
// reorder must trigger a redeploy because the compiled output depends on it.
function computeRedmodFingerprint(enabledRedmods: ModMetadata[], orderedModNames: string[]): string {
  const identity = {
    mods: enabledRedmods
      .map((mod) => ({
        folder: (mod.folderName ?? mod.uuid).toLowerCase(),
        size: mod.fileSize ?? 0,
        count: Array.isArray(mod.files) ? mod.files.length : 0,
        stamp: mod.sourceModifiedAt ?? mod.installedAt ?? '',
      }))
      .sort((left, right) => left.folder.localeCompare(right.folder)),
    order: orderedModNames.map((name) => name.toLowerCase()),
  }
  return crypto.createHash('sha1').update(JSON.stringify(identity)).digest('hex')
}

async function deployRedmodsUnderVfs(
  bridge: UsvfsBridge,
  gameRoot: string,
  overwriteDir: string,
  enabledRedmods: ModMetadata[],
  emitProgress: (progress: GameLaunchProgress) => void
): Promise<RedmodDeployOutcome> {
  const toolPath = getRedmodToolPath(gameRoot)
  if (!fs.existsSync(toolPath)) {
    appendVfsLaunchLog('redmod deploy skipped: redMod.exe not found', { toolPath })
    return { modded: false, failed: 'REDmod tool not installed (enable the free REDmod DLC on the game store)' }
  }

  // Explicit `-mod=` load order following the library: ascending priority, so a
  // later entry overrides earlier ones in redMod exactly like Hyperion's
  // higher-#-wins rule. Duplicated REDmod ids (installed copies) keep only their
  // LAST (winning) slot.
  const orderedNamesRaw = [...enabledRedmods]
    .sort((left, right) => left.order - right.order)
    .flatMap((mod) => getRedmodFolderNames(mod))
  const lastIndexByName = new Map<string, number>()
  orderedNamesRaw.forEach((name, index) => lastIndexByName.set(name.toLowerCase(), index))
  const orderedModNames = orderedNamesRaw.filter((name, index) => lastIndexByName.get(name.toLowerCase()) === index)

  const fingerprint = computeRedmodFingerprint(enabledRedmods, orderedModNames)
  const artifactDir = path.join(overwriteDir, 'r6', 'cache', 'modded')
  const artifactsPresent = fs.existsSync(artifactDir) && collectFilesRecursive(artifactDir).length > 0
  if (readRedmodDeployState()?.fingerprint === fingerprint && artifactsPresent) {
    appendVfsLaunchLog('redmod deploy skipped: fingerprint unchanged', { fingerprint, redmods: enabledRedmods.length })
    return { modded: true, skipped: true }
  }

  emitProgress({
    step: 'Deploying REDmods',
    key: 'redmod',
    percent: 84,
    cancellable: true,
    detail: `${enabledRedmods.length} REDmod(s) — starting redMod.exe`,
  })

  // Route redMod's console output to a log file (via a hooked cmd.exe redirect):
  // detached hooked launches expose neither stdout nor an exit code, and in the
  // packaged app there is no console for the output to inherit. Tailing this file
  // lets the launch card narrate the real deploy stages, and its final lines are
  // the authoritative success/failure signal ("Commandlet deploy has succeeded").
  const deployLogPath = path.join(app.getPath('userData'), 'logs', 'redmod-deploy.log')
  const cmdExePath = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')

  const readDeployLog = (): string => {
    try {
      return fs.readFileSync(deployLogPath, 'utf8')
    } catch {
      return ''
    }
  }

  type DeployAttempt =
    | { status: 'succeeded' }
    | { status: 'cancelled' }
    | { status: 'failed'; failedLine: string }

  const attemptDeploy = async (modListArgs: string): Promise<DeployAttempt> => {
    try {
      fs.mkdirSync(path.dirname(deployLogPath), { recursive: true })
      fs.rmSync(deployLogPath, { force: true })
    } catch {
      // Best-effort; the artifact fallback below still validates the deploy.
    }

    const startedAt = Date.now()
    const launch = bridge.launchHookedProcess({
      appPath: cmdExePath,
      // Hooked into the VFS: redMod reads the virtual mods/ tree and its writes
      // land in the overwrite capture instead of the real game folder.
      commandLine: `"${cmdExePath}" /s /c ""${toolPath}" deploy -root="${gameRoot}"${modListArgs} > "${deployLogPath}" 2>&1"`,
      cwd: path.dirname(toolPath),
      capture: false,
      waitMs: 0,
    })
    appendVfsLaunchLog('redmod deploy started', {
      ...launch,
      fingerprint,
      redmods: enabledRedmods.length,
      modListArgs: modListArgs || '(default: all mods, alphabetical)',
      deployLogPath,
    })
    if (!launch.ok || !launch.pid) {
      return { status: 'failed', failedLine: `failed to start (${launch.stage ?? 'unknown stage'})` }
    }

    // Poll (never block the main thread) until redMod exits, honoring cancellation
    // and narrating the tool's own progress lines in the launch card.
    let lastDetail = ''
    for (;;) {
      if (vfsLaunchCancelRequested) {
        exec(`taskkill /PID ${launch.pid} /T /F`, { windowsHide: true }, () => undefined)
        return { status: 'cancelled' }
      }
      if (Date.now() - startedAt > REDMOD_DEPLOY_TIMEOUT_MS) {
        exec(`taskkill /PID ${launch.pid} /T /F`, { windowsHide: true }, () => undefined)
        appendVfsLaunchLog('redmod deploy timed out', { pid: launch.pid })
        return { status: 'failed', failedLine: 'timed out' }
      }

      const logContent = readDeployLog()
      const stageMatches = [...logContent.matchAll(/\[DEPLOY\] Stage (\d+)\/(\d+) - (.+)/g)]
      const lastStage = stageMatches[stageMatches.length - 1]
      const foundMods = logContent.match(/^Found mod .+$/gm)?.length ?? 0
      if (lastStage) {
        const stageNumber = Number.parseInt(lastStage[1], 10)
        const stageTotal = Math.max(1, Number.parseInt(lastStage[2], 10))
        const detail = `Stage ${lastStage[1]}/${lastStage[2]} — ${lastStage[3].trim()}${foundMods > 0 ? ` · ${foundMods} mod(s)` : ''}`
        if (detail !== lastDetail) {
          lastDetail = detail
          emitProgress({
            step: 'Deploying REDmods',
            key: 'redmod',
            percent: Math.min(90, 84 + Math.round((stageNumber / stageTotal) * 6)),
            cancellable: true,
            detail,
          })
        }
      }

      if (!(await isProcessRunningByPid(launch.pid))) break
      await new Promise((resolve) => setTimeout(resolve, REDMOD_DEPLOY_POLL_MS))
    }

    const finalLog = readDeployLog()
    const logSaysSuccess = /deploy has succeeded/i.test(finalLog)
    const logSaysFailure = /deploy has failed|\bfatal\b/i.test(finalLog)
    // Fallback (log unreadable): compiled output landing in the capture this run.
    const produced = fs.existsSync(artifactDir) && collectFilesRecursive(artifactDir).some((filePath) => {
      try {
        return fs.statSync(filePath).mtimeMs >= startedAt - 2000
      } catch {
        return false
      }
    })
    appendVfsLaunchLog('redmod deploy finished', {
      durationMs: Date.now() - startedAt,
      logSaysSuccess,
      logSaysFailure,
      produced,
      artifactDir,
      logTail: finalLog.slice(-1500),
    })
    if (logSaysSuccess || (!logSaysFailure && (produced || artifactsPresent))) {
      return { status: 'succeeded' }
    }
    const tailLine = finalLog.trim().split(/\r?\n/).filter(Boolean).pop() ?? 'no output'
    return { status: 'failed', failedLine: tailLine.slice(0, 200) }
  }

  const modListArgs = orderedModNames.map((name) => ` -mod= "${name}"`).join('')
  let attempt = await attemptDeploy(modListArgs)

  // Older/newer redMod builds may reject the -mod list syntax; retry once with
  // the default (all mods in the virtual folder, alphabetical) rather than
  // failing the whole launch over a load-order refinement.
  if (attempt.status === 'failed' && modListArgs) {
    appendVfsLaunchLog('redmod deploy retrying without explicit -mod list', { failedLine: attempt.failedLine })
    emitProgress({
      step: 'Deploying REDmods',
      key: 'redmod',
      percent: 84,
      cancellable: true,
      detail: 'Retrying with the default load order',
    })
    attempt = await attemptDeploy('')
  }

  if (attempt.status === 'cancelled') return { modded: false, cancelled: true }
  if (attempt.status === 'failed') {
    return { modded: false, failed: `REDmod deploy failed: ${attempt.failedLine}` }
  }

  writeRedmodDeployState({ fingerprint, deployedAt: new Date().toISOString() })
  return { modded: true }
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
      // Require two consecutive misses (8 s) before tearing down: a single
      // transient tasklist failure paired with a bridge hiccup must not clear
      // the virtual mappings under a game that is actually still running.
      if (missingChecks >= 2) {
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

// The cap is a guard against pathological folders, not a working size — the renderer
// windows its rows, and the per-file registry lookup is an O(1) in-memory index, so
// thousands of archives enumerate fine.
function collectDownloadEntries(dirPath: string, limit = 10000): Array<{
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
// Hard cap on how long the splash may stay up after the window can paint. Past this we
// reveal regardless of the renderer's APP_READY signal so a stalled boot can't hang the
// user on the splash indefinitely.
const SPLASH_SAFETY_REVEAL_MS = 12000
const pendingNxmUrls: string[] = []

// Watches the configured Downloads folder so externally-added archives (e.g. a
// manual Nexus download dropped into the folder) surface in the Downloads view
// without a manual refresh. Non-recursive fs.watch is enough — the folder is flat.
let downloadsWatcher: fs.FSWatcher | null = null
let downloadsWatcherPath: string | null = null
let downloadsChangeTimer: ReturnType<typeof setTimeout> | null = null

function stopDownloadsWatcher(): void {
  if (downloadsChangeTimer) {
    clearTimeout(downloadsChangeTimer)
    downloadsChangeTimer = null
  }
  if (downloadsWatcher) {
    try {
      downloadsWatcher.close()
    } catch {
      // Best-effort teardown.
    }
    downloadsWatcher = null
  }
  downloadsWatcherPath = null
}

function startDownloadsWatcher(downloadPath: string | undefined | null): void {
  const target = downloadPath?.trim()
  // Re-mounting on the same path would just churn handles for no gain.
  if (target && target === downloadsWatcherPath && downloadsWatcher) return
  stopDownloadsWatcher()
  if (!target || !isUsableDirectoryPath(target)) return
  try {
    downloadsWatcher = fs.watch(target, { persistent: false }, () => {
      // Debounce bursts (archive writes fire many events) into one refresh ping.
      if (downloadsChangeTimer) clearTimeout(downloadsChangeTimer)
      downloadsChangeTimer = setTimeout(() => {
        downloadsChangeTimer = null
        safeSendToWindow(mainWindow, IPC.DOWNLOADS_CHANGED)
      }, 400)
    })
    downloadsWatcherPath = target
    downloadsWatcher.on('error', () => {
      // A removed/renamed folder invalidates the watcher; drop it and let the
      // next settings change or app restart re-establish it.
      stopDownloadsWatcher()
    })
  } catch {
    stopDownloadsWatcher()
  }
}

let libraryWatcher: fs.FSWatcher | null = null
let libraryWatcherPath: string | null = null
let libraryChangeTimer: ReturnType<typeof setTimeout> | null = null

// Files Hyperion itself writes into the library on every scan/index. The watcher ignores
// them so the renderer's refresh-on-change (which can rewrite metadata) never loops back
// into another change event.
const LIBRARY_WATCH_IGNORED_FILES = new Set(['_metadata.json', '_archive_resources.json'])

function stopLibraryWatcher(): void {
  if (libraryChangeTimer) {
    clearTimeout(libraryChangeTimer)
    libraryChangeTimer = null
  }
  if (libraryWatcher) {
    try {
      libraryWatcher.close()
    } catch {
      // Closing an already-invalid watcher is fine.
    }
    libraryWatcher = null
  }
  libraryWatcherPath = null
}

// Watch the mod library (recursively) so files added/removed directly in a mod folder via
// Explorer surface without a manual refresh — mirrors the Downloads watcher. Routine scans
// reuse each mod's stored file list for speed and never re-walk the folder, so this is what
// keeps the library honest about on-disk reality.
function startLibraryWatcher(libraryPath: string | undefined | null): void {
  const target = libraryPath?.trim()
  if (target && target === libraryWatcherPath && libraryWatcher) return
  stopLibraryWatcher()
  if (!target || !isUsableDirectoryPath(target)) return
  try {
    libraryWatcher = fs.watch(target, { persistent: false, recursive: true }, (_event, filename) => {
      // Skip Hyperion's own metadata/sidecar writes so a refresh that rewrites them doesn't
      // re-trigger the watcher in a loop. (On Windows recursive watches report the filename.)
      if (filename && LIBRARY_WATCH_IGNORED_FILES.has(path.basename(filename.toString()))) return
      // Writing a file also fires a directory-level event (the mod folder's own mtime) whose
      // filename is the folder, which the name filter above can't catch — so also ignore any
      // event that lands inside a self-write window opened by our metadata/sidecar writers.
      // Without this, a metadata-refreshing scan endlessly re-triggers itself (infinite loop).
      if (isLibraryWatchSuppressed()) return
      if (libraryChangeTimer) clearTimeout(libraryChangeTimer)
      libraryChangeTimer = setTimeout(() => {
        libraryChangeTimer = null
        safeSendToWindow(mainWindow, IPC.LIBRARY_CHANGED)
      }, 500)
    })
    libraryWatcherPath = target
    libraryWatcher.on('error', () => {
      // A removed/renamed library folder invalidates the watcher; drop it and let the next
      // settings change or app restart re-establish it.
      stopLibraryWatcher()
    })
  } catch {
    stopLibraryWatcher()
  }
}

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

// Resolution-proportional UI scaling.
//
// The window already opens at a percentage of the display work area
// (getInitialMainWindowBounds), but the renderer is laid out in fixed pixels.
// Without scaling the content, a 1080p screen gets a smaller window holding the
// same-size UI (columns truncate to "Down…", controls cramp) while a 4K screen
// gets a huge window holding a tiny, sparse UI. We apply a single zoom factor to
// the whole page so 1080p / 1440p / 4K all render the SAME logical layout, just
// physically larger or smaller.
//
// The factor is derived from the display work area relative to a 1440p baseline
// (the design target). Electron reports the work area in DIPs, so OS display
// scaling (e.g. 150% on a 4K laptop) is already folded in. Because both the
// window size and this zoom scale by the same ratio off the baseline, every
// resolution ends up with an identical amount of logical layout space.
const ZOOM_BASELINE_WIDTH = 2560
const ZOOM_BASELINE_HEIGHT = 1440
const ZOOM_MIN = 0.7
const ZOOM_MAX = 2.0

function computeResolutionZoom(win: BrowserWindow): number {
  const display = screen.getDisplayMatching(win.getBounds())
  const { width, height } = display.workArea
  const ratio = Math.min(width / ZOOM_BASELINE_WIDTH, height / ZOOM_BASELINE_HEIGHT)
  return clampNumber(Math.round(ratio * 100) / 100, ZOOM_MIN, ZOOM_MAX)
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

  // Keep the whole UI scaled to the display the window currently lives on.
  let appliedZoom = 0
  const syncZoom = (force = false): void => {
    if (win.isDestroyed()) return
    const factor = computeResolutionZoom(win)
    if (!force && factor === appliedZoom) return
    appliedZoom = factor
    win.webContents.setVisualZoomLevelLimits(1, 1)
    win.webContents.setZoomFactor(factor)
  }
  // A (re)load resets the zoom factor to 1, so force-reapply after every load.
  win.webContents.on('did-finish-load', () => syncZoom(true))
  // Re-derive the factor when the window is dragged onto another monitor or the
  // display configuration changes (resolution / scaling updates at runtime).
  win.on('moved', () => syncZoom())
  const onDisplayMetricsChanged = (): void => syncZoom(true)
  screen.on('display-metrics-changed', onDisplayMetricsChanged)
  win.on('closed', () => screen.removeListener('display-metrics-changed', onDisplayMetricsChanged))

  attachEditContextMenu(win)

  // DevTools toggle. The window is frameless and no application menu is set, so the
  // default Ctrl+Shift+I / F12 accelerators don't fire — bind them explicitly here so
  // the console is reachable in any build (dev or packaged) for diagnostics.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = (input.key || '').toLowerCase()
    const isToggleDevTools = key === 'f12' || (input.control && input.shift && key === 'i')
    if (isToggleDevTools) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

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

      // Re-point the Downloads + library folder watchers at the (possibly) new paths.
      startDownloadsWatcher(settings.downloadPath)
      startLibraryWatcher(settings.libraryPath)

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

  ipcMain.handle(IPC.MOD_UPDATE_CACHE_GET, () => loadModUpdateCache())
  ipcMain.handle(IPC.MOD_UPDATE_CACHE_SET, (_event, cache: ModUpdateCache) => {
    saveModUpdateCache(cache)
    return { ok: true }
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

  const runVfsLaunch = async (): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> => {
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
          key: 'launch',
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
        key: 'scan',
        percent: 10,
        detail: settings.libraryPath ?? 'No library path configured',
      })
      const mods = settings.libraryPath ? await scanMods(settings.libraryPath) : []
      const enabledMods = mods.filter((mod) => mod.kind === 'mod' && mod.enabled)
      const scanCancelled = cancelledLaunchResult(18)
      if (scanCancelled) return scanCancelled

      emitLaunchProgress({
        step: 'Building VFS map',
        key: 'map',
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
        key: 'bridge',
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
          key: 'overwrite',
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
        key: 'bootstrap',
        percent: 58,
        detail: 'Staging import-time loader files when needed',
      })
      const bootstrapStage = settings.libraryPath
        ? stageVfsBootstrapFiles(gameRoot, settings.libraryPath, enabledMods)
        : { ok: true, entries: [], tempDirs: [] }
      appendVfsLaunchLog('vfs bootstrap staging result', bootstrapStage)
      // Fold in staging left by a previous session that never ran its cleanup
      // (crash, kill, or quit while the game was attached), so those files are
      // removed on this run's game exit instead of lingering in the game folder.
      const leftoverStaging = readBootstrapStagingManifest()
      stagedBootstrapEntries = mergeStagedBootstrapEntries(
        leftoverStaging?.entries,
        bootstrapStage.entries.filter((entry) => entry.status === 'copied')
      )
      stagedBootstrapTempDirs = mergeStagedTempDirs(leftoverStaging?.tempDirs, bootstrapStage.tempDirs)
      persistBootstrapStagingManifest()
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
      stagedBootstrapOverrideDirs = [
        ...new Set([...(leftoverStaging?.overrideDirs ?? []), ...bootstrapOverrides.dirs]),
      ]
      persistBootstrapStagingManifest()
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

      // Final guard: usvfs fails repeated identical links, so collapse any exact
      // duplicates across every builder (mod plan, bootstrap overrides, overwrite
      // layer, read overlays) before mounting. Keyed on the full link identity —
      // dir/createTarget flags matter, so an overwrite createTarget dir link and a
      // read overlay file link to the same dest are correctly kept distinct.
      const dedupedSeen = new Set<string>()
      links = links.filter((link) => {
        const key = `${link.source} ${link.dest} ${link.dir ? 1 : 0} ${link.createTarget ? 1 : 0}`
        if (dedupedSeen.has(key)) return false
        dedupedSeen.add(key)
        return true
      })

      emitLaunchProgress({
        step: 'Mounting usvfs',
        key: 'mount',
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

      // REDmod deploy: run redMod.exe hooked into the mounted VFS so it compiles the
      // virtual mods/ tree into r6/cache/modded (captured into the Overwrite folder —
      // the real game dir stays clean), then launch the game with -modded so the
      // compiled output is actually used. Failure degrades to a normal launch.
      let launchModded = false
      const enabledRedmods = enabledMods.filter((mod) => modHasRedmodContent(mod))
      if (enabledRedmods.length > 0) {
        const redmodOutcome = await deployRedmodsUnderVfs(
          bridge,
          gameRoot,
          overwriteDir,
          enabledRedmods,
          emitLaunchProgress
        )
        if (redmodOutcome.cancelled) return finishCancelledLaunch(86)
        launchModded = redmodOutcome.modded
        if (!redmodOutcome.modded && redmodOutcome.failed) {
          pushGeneralLog(mainWindow, {
            level: 'warn',
            source: 'launcher',
            message: 'REDmod deploy failed — launching without -modded (REDmods will not load)',
            details: { error: redmodOutcome.failed, redmods: enabledRedmods.length, logPath: getVfsLaunchLogPath() },
          })
        }
      }

      emitLaunchProgress({
        step: 'Launching Cyberpunk2077.exe',
        key: 'launch',
        percent: 92,
        state: 'running',
        cancellable: false,
        detail: `${mount.linked ?? 0} VFS link(s) mounted${launchModded ? ' · REDmod enabled' : ''}`,
      })
      const launch = bridge.launchHookedProcess({
        appPath: launchTarget,
        commandLine: `"${launchTarget}"${launchModded ? ' -modded' : ''}`,
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
  }

  ipcMain.handle(IPC.LAUNCH_GAME, async () => {
    // Re-entry guard: mounting again while a hooked game is attached would reset
    // the shared usvfs state under it (usvfsCreateVFS re-creates the VFS), so a
    // second Launch — double-click or a stale renderer state — must never reach
    // the mount path while a launch is in flight or the game is running.
    if (vfsLaunchInProgress) {
      return { ok: false, error: 'A game launch is already in progress' }
    }

    let attachedToVfs = false
    try {
      attachedToVfs = vfsMounted && (loadVfsBridge()?.vfsProcesses?.() ?? []).length > 0
    } catch {
      attachedToVfs = false
    }
    if (attachedToVfs || await isGameProcessRunning()) {
      return { ok: false, error: 'Cyberpunk 2077 is already running. Close the game before launching again.' }
    }

    vfsLaunchInProgress = true
    try {
      return await runVfsLaunch()
    } finally {
      vfsLaunchInProgress = false
    }
  })

  ipcMain.handle(IPC.GAME_RUNNING, (): Promise<boolean> => {
    return isGameProcessRunning()
  })

  ipcMain.handle(IPC.KILL_GAME, (): Promise<{ ok: boolean }> => {
    return new Promise((resolve) => {
      exec('taskkill /F /IM Cyberpunk2077.exe /T', { windowsHide: true }, (err) => {
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
  // Show splash while loading, matching the user's accent color and light/dark mode
  const bootSettings = loadSettings()
  const splash = createSplashWindow(bootSettings.accentColor, bootSettings.uiMode)
  let mainWindowReadyToShow = false
  let mainWindowRevealed = false

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

  // Splash safety net as an INACTIVITY watchdog rather than an absolute deadline: a
  // large library can boot for >12s while progressing perfectly fine (mod scan +
  // first-run conflict re-index), so an absolute timer fired the false "did not
  // signal in time" warning and revealed early. Instead, every boot-status update
  // (and the initial first-paint) re-arms the timer, so it only fires after a real
  // stall — the renderer going silent for the whole grace period with no progress
  // and no APP_READY. That's the genuine "stuck on LOADING SETTINGS…" hang.
  let splashSafetyTimer: ReturnType<typeof setTimeout> | null = null
  const clearSplashSafetyWatchdog = () => {
    if (splashSafetyTimer) {
      clearTimeout(splashSafetyTimer)
      splashSafetyTimer = null
    }
  }
  const armSplashSafetyWatchdog = () => {
    if (mainWindowRevealed) return
    clearSplashSafetyWatchdog()
    splashSafetyTimer = setTimeout(() => {
      splashSafetyTimer = null
      if (mainWindowRevealed || !mainWindow || mainWindow.isDestroyed()) return
      pushGeneralLog(mainWindow, {
        level: 'warn',
        source: 'app',
        message: 'Renderer went silent during boot; revealing window via safety net',
      })
      rendererReady = true
      revealMainWindow()
    }, SPLASH_SAFETY_REVEAL_MS)
  }

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

  // NOTE: the WolvenKit resource-hash DB is intentionally NOT preloaded here. It's a
  // ~1.7M-entry Map (a few hundred MB resident) and, since conflict detection treats an
  // already-indexed sidecar as final and resolves names from the DB only on demand, the
  // boot conflict pass never needs it. It now loads lazily on the first install/re-index
  // or lazy name resolution (with the faster parse), so an idle session never pays the
  // RAM for a DB it won't use. Do not reintroduce an eager boot preload.

  // Ensure library directory exists
  if (settings.libraryPath && !fs.existsSync(settings.libraryPath)) {
    fs.mkdirSync(settings.libraryPath, { recursive: true })
  }
  const cleanedInstallerTempDirs = cleanupInstallerTempDirs(settings)
  // Replay any bootstrap cleanup a previous session never ran (crash/kill/quit
  // while the game was attached), so staged loader files don't linger in the
  // game folder.
  void sweepLeftoverBootstrapStaging()

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

  // Watch the Downloads + mod library folders so externally-added files appear without a
  // manual refresh.
  startDownloadsWatcher(settings.downloadPath)
  startLibraryWatcher(settings.libraryPath)

  mainWindow.once('ready-to-show', () => {
    mainWindowReadyToShow = true
    revealMainWindow()
    // Start the inactivity watchdog (re-armed on every boot-status update below).
    armSplashSafetyWatchdog()
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
  ipcMain.on(IPC.APP_BOOT_STATUS, () => {
    // The splash is animation-only now (no status text), but these still arrive as a
    // boot heartbeat — the renderer is alive, so push the inactivity watchdog back.
    armSplashSafetyWatchdog()
  })

  ipcMain.once(IPC.APP_READY, () => {
    rendererReady = true
    clearSplashSafetyWatchdog()
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
  // Tear down any active VFS so usvfs shared state doesn't outlive the controller —
  // but NEVER while the game is still attached: clearing the virtual mappings under
  // a running hooked process would make every mod file vanish mid-session. In that
  // case leave the VFS resident (the game's own handle keeps the shared memory
  // alive) and let the startup sweep / next launch reconcile staged bootstrap
  // files and runtime residue from the persisted manifest.
  let attachedToVfs = false
  try {
    attachedToVfs = vfsMounted && (loadVfsBridge()?.vfsProcesses?.() ?? []).length > 0
  } catch {
    attachedToVfs = false
  }
  if (attachedToVfs) {
    appendVfsLaunchLog('app quitting with game attached to VFS — leaving VFS resident')
  } else {
    unmountVfsIfMounted()
  }
  stopDownloadsWatcher()
  stopLibraryWatcher()
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
