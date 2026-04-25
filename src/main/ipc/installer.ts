import { app, ipcMain, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn, spawnSync } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from '../../shared/types'
import type {
  ModMetadata,
  IpcResult,
  ConflictInfo,
  DuplicateModInfo,
  InstallDuplicateAction,
  InstallModRequest,
  InstallModResponse,
} from '../../shared/types'
import { pushGeneralLog, safeSendToWindow } from '../logStore'
import { loadSettings } from '../settings'
import { detectModType } from './archiveParser'
import { resolveHashes } from './hashResolver'
import { disableMod, findModDir, getTrackedDeploymentPaths, normalizeRelativePath, scanMods } from './modManager'
import { listFilesRecursive, getPathSizeSafe } from '../fileUtils'
import { findNexusDownloadRecordByPath } from '../nexusDownloadRegistry'

type GetMainWindow = () => BrowserWindow | null

const SUPPORTED_EXTENSIONS = new Set(['.zip', '.7z', '.rar'])
const PRESERVED_ARCHIVE_ROOT_DIRS = new Set(['archive', 'archives', 'bin', 'engine', 'mods', 'r6', 'red4ext'])

interface ArchiveExtractor {
  binPath: string
  label: string
  supportsRar: boolean
}

const rarSupportCache = new Map<string, boolean>()
const PACKAGED_7ZIP_DIR = path.join(process.resourcesPath, 'tools', '7zip')

function unpackElectronAsarPath(filePath: string): string {
  return filePath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

function resolveDevBundled7ZipBinary(): string {
  const packageRoot = path.dirname(require.resolve('7zip-bin-full/package.json'))

  if (process.platform === 'win32') {
    return path.join(packageRoot, 'win', process.arch, '7z.exe')
  }

  if (process.platform === 'darwin') {
    return path.join(packageRoot, 'mac', process.arch, '7zz')
  }

  return path.join(packageRoot, 'linux', process.arch, '7zz')
}

function resolvePackagedBundled7ZipBinary(): string {
  const binaryName = process.platform === 'win32' ? '7z.exe' : '7zz'
  return path.join(PACKAGED_7ZIP_DIR, binaryName)
}

function buildErrorDetails(error: unknown, extra?: Record<string, unknown>): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string }
    return {
      ...extra,
      error: error.message,
      code: errorWithCode.code,
    }
  }

  return {
    ...extra,
    error: String(error),
  }
}

function sendProgress(
  win: BrowserWindow | null,
  step: string,
  percent: number,
  currentFile?: string
): void {
  safeSendToWindow(win, IPC.INSTALL_PROGRESS, { step, percent, currentFile })
}

function supportsRarExtraction(binPath: string): boolean {
  const cached = rarSupportCache.get(binPath)
  if (cached !== undefined) return cached

  try {
    const result = spawnSync(binPath, ['i'], {
      encoding: 'utf-8',
      windowsHide: true,
    })
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    const supported = output.includes(' Rar      rar') || output.includes(' Rar5     rar')
    rarSupportCache.set(binPath, supported)
    return supported
  } catch {
    rarSupportCache.set(binPath, false)
    return false
  }
}

function resolveArchiveExtractor(extension: string): ArchiveExtractor {
  void extension
  const binPath = app.isPackaged
    ? resolvePackagedBundled7ZipBinary()
    : unpackElectronAsarPath(resolveDevBundled7ZipBinary())

  return {
    binPath,
    label: '7z',
    supportsRar: fs.existsSync(binPath) && supportsRarExtraction(binPath),
  }
}

function countArchiveFiles(extractor: ArchiveExtractor, archivePath: string): Promise<number> {
  return new Promise((resolve) => {
    const args = ['l', '-ba', '-slt', archivePath]
    const proc = spawn(extractor.binPath, args, { windowsHide: true })
    let count = 0
    let buffer = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('Attr = ') && !line.includes('D')) count++
        if (/^Attributes = [^D]/.test(line)) count++
      }
    })

    proc.on('close', () => resolve(Math.max(count, 1)))
    proc.on('error', () => resolve(1))
  })
}

function extractArchiveAsync(
  extractor: ArchiveExtractor,
  archivePath: string,
  destDir: string,
  totalFiles: number,
  onFile: (name: string, percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['x', archivePath, `-o${destDir}`, '-y', '-bb1', '-bd']
    const proc = spawn(extractor.binPath, args, { windowsHide: true })
    let extracted = 0
    let buffer = ''
    let stderrBuffer = ''
    let stdoutTail = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdoutTail = `${stdoutTail}${text}`.slice(-4000)
      buffer += text
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trimStart()
        if (trimmed.startsWith('- ') || trimmed.startsWith('Extracting  ')) {
          const name = trimmed.replace(/^(- |Extracting\s+)/, '').trim()
          extracted++
          const percent = Math.min(99, Math.round((extracted / totalFiles) * 90) + 5)
          onFile(name, percent)
        }
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer = `${stderrBuffer}${chunk.toString()}`.slice(-4000)
    })

    proc.on('close', (code) => {
      if (code === 0 || code === null) resolve()
      else {
        const details = `${stderrBuffer}\n${stdoutTail}`.trim()
        const suffix = details ? `: ${details.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-3).join(' | ')}` : ''
        reject(new Error(`Extraction failed via ${extractor.label} (exit code ${code})${suffix}`))
      }
    })

    proc.on('error', (err) => reject(new Error(`Could not start extractor ${extractor.label}: ${err.message}`)))
  })
}

/**
 * Installs a mod from a file path (zip archive or folder).
 * Returns conflicts if any exist; the caller must resolve them before committing.
 */
function sanitizeFolderName(name: string): string {
  return (name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 80)) || 'mod'
}

function uniqueFolderName(libraryPath: string, base: string): string {
  let candidate = base
  let i = 1
  while (fs.existsSync(path.join(libraryPath, candidate))) {
    candidate = `${base}_${i++}`
  }
  return candidate
}

function uniqueDisplayName(existingMods: ModMetadata[], base: string): string {
  const usedNames = new Set(existingMods.map((mod) => mod.name.trim().toLowerCase()))
  if (!usedNames.has(base.trim().toLowerCase())) return base

  let index = 1
  let candidate = `${base} Copy`
  while (usedNames.has(candidate.trim().toLowerCase())) {
    index += 1
    candidate = `${base} Copy ${index}`
  }
  return candidate
}

function shouldPreserveArchiveRootFolder(folderName: string): boolean {
  return PRESERVED_ARCHIVE_ROOT_DIRS.has(folderName.trim().toLowerCase())
}

function extractVersionFromName(rawName: string): string | undefined {
  const cleaned = rawName
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*nexus[^)]*\)/gi, ' ')
    .replace(/[_]+/g, ' ')
    .trim()

  const dashParts = cleaned.split('-').map((part) => part.trim()).filter(Boolean)
  if (dashParts.length > 1) {
    for (let index = 1; index < dashParts.length; index += 1) {
      const trailing = dashParts.slice(index)
      const versionLike = trailing.every((part) => /^v?\d+[a-z0-9.]*$/i.test(part))
      if (versionLike) {
        return trailing.map((part) => part.replace(/^v/i, '')).join('.')
      }
    }
  }

  const match = /[-_ ]v?(\d+(?:[._-]\d+)+)$/i.exec(cleaned)
  if (match) return match[1].replace(/[_-]/g, '.')

  return undefined
}

function normalizeModName(rawName: string): string {
  const cleaned = rawName
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*nexus[^)]*\)/gi, ' ')
    .replace(/[_]+/g, ' ')
    .trim()

  const dashParts = cleaned.split('-').map((part) => part.trim()).filter(Boolean)
  if (dashParts.length > 1) {
    for (let index = 1; index < dashParts.length; index += 1) {
      const trailing = dashParts.slice(index)
      const versionLike = trailing.every((part) => /^v?\d+[a-z0-9.]*$/i.test(part))
      if (versionLike) {
        return dashParts.slice(0, index).join(' - ').trim()
      }
    }
  }

  return cleaned
    .replace(/[-_]?v?\d+(?:[._-]\d+)+(?:[._-]\d+)*$/i, '')
    .replace(/[-_ ]+$/g, '')
    .trim() || rawName
}

function normalizeInstallRequest(input: string | InstallModRequest): InstallModRequest {
  if (typeof input === 'string') {
    return {
      filePath: input,
      duplicateAction: 'prompt',
    }
  }

  return {
    duplicateAction: 'prompt',
    ...input,
  }
}

function getSourceModifiedAt(sourcePath: string): string | undefined {
  try {
    return fs.statSync(sourcePath).mtime.toISOString()
  } catch {
    return undefined
  }
}

function findDuplicateMod(
  existingMods: ModMetadata[],
  rawName: string,
  folderBase: string,
  targetModId?: string
): ModMetadata | null {
  if (targetModId) {
    return existingMods.find((mod) => mod.uuid === targetModId) ?? null
  }

  const normalizedName = rawName.trim().toLowerCase()
  const normalizedFolderBase = folderBase.trim().toLowerCase()

  return existingMods.find((mod) => {
    if (mod.kind !== 'mod') return false

    const modName = mod.name.trim().toLowerCase()
    const folderName = (mod.folderName ?? '').trim().toLowerCase()
    return modName === normalizedName || folderName === normalizedFolderBase
  }) ?? null
}

function getNextInstallOrder(existingMods: ModMetadata[]): number {
  return existingMods
    .reduce((highestOrder, mod) => Math.max(highestOrder, mod.order), -1) + 1
}

function getInstallOrderForCopy(existingMods: ModMetadata[], sourceMod: ModMetadata): number {
  const nextOrder = sourceMod.order + 1
  return Math.max(nextOrder, 0)
}

function shiftInstallOrdersForInsert(
  libraryPath: string,
  existingMods: ModMetadata[],
  fromOrder: number
): void {
  const entriesToShift = [...existingMods]
    .filter((entry) => entry.order >= fromOrder)
    .sort((left, right) => right.order - left.order)

  for (const entry of entriesToShift) {
    const found = findModDir(libraryPath, entry.uuid)
    if (!found) continue

    const updated = { ...found.mod, order: found.mod.order + 1 }
    fs.writeFileSync(
      path.join(found.dir, '_metadata.json'),
      JSON.stringify(updated, null, 2),
      'utf-8'
    )
    entry.order = updated.order
  }
}

async function removeExistingMod(
  mod: ModMetadata,
  settings: ReturnType<typeof loadSettings>
): Promise<IpcResult> {
  if (mod.enabled) {
    const disableResult = await disableMod(mod, settings.gamePath, settings.libraryPath)
    if (!disableResult.ok) return disableResult
  }

  const found = findModDir(settings.libraryPath, mod.uuid)
  if (!found) return { ok: false, error: 'Existing mod directory not found' }

  fs.rmSync(found.dir, { recursive: true, force: true })
  return { ok: true }
}

async function installMod(
  requestInput: string | InstallModRequest,
  settings: ReturnType<typeof loadSettings>,
  win: BrowserWindow | null
): Promise<IpcResult<InstallModResponse>> {
  const request = normalizeInstallRequest(requestInput)
  const { filePath, duplicateAction = 'prompt', targetModId } = request
  const targetModMatchId = targetModId
  const ext = path.extname(filePath).toLowerCase()
  const extractor = resolveArchiveExtractor(ext)
  let isDir = false
  let normalizedName = path.basename(filePath, ext) || path.basename(filePath)
  let folderBase = sanitizeFolderName(normalizedName)
  const tempDir = path.join(settings.libraryPath, `_tmp_${uuidv4()}`)
  let modDir = ''

  try {
    isDir = fs.statSync(filePath).isDirectory()
    if (!isDir && !SUPPORTED_EXTENSIONS.has(ext)) {
      pushGeneralLog(win, {
        level: 'error',
        source: 'install',
        message: 'Install failed: unsupported format',
        details: { filePath, extension: ext },
      })
      return { ok: false, error: `Unsupported format: ${ext}. Supported: .zip, .7z, .rar` }
    }
    if (!isDir && !fs.existsSync(extractor.binPath)) {
      pushGeneralLog(win, {
        level: 'error',
        source: 'install',
        message: 'Install failed: bundled extractor is missing',
        details: {
          filePath,
          extractor: extractor.label,
          extractorPath: extractor.binPath,
          packaged: app.isPackaged,
        },
      })
      return {
        ok: false,
        error: 'The bundled Hyperion extractor is missing. Reinstall Hyperion or rebuild the app package.',
      }
    }
    if (!isDir && ext === '.rar' && !extractor.supportsRar) {
      pushGeneralLog(win, {
        level: 'error',
        source: 'install',
        message: 'Install failed: RAR extraction is unavailable',
        details: {
          filePath,
          extractor: extractor.label,
          extractorPath: extractor.binPath,
          extension: ext,
        },
      })
      return {
        ok: false,
        error: 'The bundled Hyperion extractor does not have RAR support available. Reinstall Hyperion or rebuild the app package.',
      }
    }

    const rawName = isDir ? path.basename(filePath) : path.basename(filePath, ext)
    normalizedName = normalizeModName(rawName)
    folderBase = sanitizeFolderName(rawName)

    pushGeneralLog(win, {
      level: 'info',
      source: 'install',
      message: `Install started: ${normalizedName}`,
      details: {
        filePath,
        duplicateAction,
        targetModId,
      },
    })

    sendProgress(win, 'Preparing...', 5)
    fs.mkdirSync(tempDir, { recursive: true })

    if (isDir) {
      sendProgress(win, 'Copying files...', 10)
      copyDirSync(filePath, tempDir)
    } else {
      sendProgress(win, 'Reading archive...', 8)
      const totalFiles = await countArchiveFiles(extractor, filePath)
      await extractArchiveAsync(extractor, filePath, tempDir, totalFiles, (name, percent) => {
        sendProgress(win, 'Extracting...', percent, name.replace(/\\/g, '/'))
      })
    }

    sendProgress(win, 'Detecting mod type...', 95)

    // Flatten single-subfolder wrapping (common in mod archives)
    const tempContents = fs.readdirSync(tempDir, { withFileTypes: true })
    let extractRoot = tempDir
    if (tempContents.length === 1) {
      const [singleEntry] = tempContents
      const single = path.join(tempDir, singleEntry.name)
      if (singleEntry.isDirectory() && !shouldPreserveArchiveRootFolder(singleEntry.name)) {
        extractRoot = single
      }
    }

    const modType = detectModType(extractRoot)

    sendProgress(win, 'Checking for conflicts...', 96)

    // Detect conflicts using archive hashes
    const existingMods = await scanMods(settings.libraryPath)
    const duplicateMod = findDuplicateMod(existingMods, normalizedName, folderBase, targetModMatchId)
    const nextInstallOrder = getNextInstallOrder(existingMods)
    const installOrder = duplicateAction === 'replace'
      ? (duplicateMod?.order ?? existingMods.length)
      : duplicateAction === 'copy' && duplicateMod
        ? getInstallOrderForCopy(existingMods, duplicateMod)
        : nextInstallOrder

    if (duplicateMod && duplicateAction === 'prompt') {
      fs.rmSync(tempDir, { recursive: true, force: true })
      sendProgress(win, 'Duplicate mod detected', 100)
      const duplicate: DuplicateModInfo = {
        existingModId: duplicateMod.uuid,
        existingModName: duplicateMod.name,
        incomingModName: normalizedName,
        sourcePath: filePath,
      }
      return {
        ok: true,
        data: {
          status: 'duplicate',
          duplicate,
        },
      }
    }

    if (duplicateMod && duplicateAction === 'replace') {
      const removalResult = await removeExistingMod(duplicateMod, settings)
      if (!removalResult.ok) {
        fs.rmSync(tempDir, { recursive: true, force: true })
        return { ok: false, error: removalResult.error }
      }
    }

    if (duplicateAction === 'copy' && installOrder < nextInstallOrder) {
      shiftInstallOrdersForInsert(settings.libraryPath, existingMods, installOrder)
    }

    const modName = duplicateAction === 'copy'
      ? uniqueDisplayName(existingMods, normalizedName)
      : duplicateMod?.name ?? normalizedName
    const folderName = duplicateAction === 'replace' && duplicateMod?.folderName
      ? duplicateMod.folderName
      : uniqueFolderName(settings.libraryPath, sanitizeFolderName(modName))
    const modUuid = (duplicateAction === 'replace' && duplicateMod?.uuid) ? duplicateMod.uuid : uuidv4()
    modDir = path.join(settings.libraryPath, folderName)
    const enabledMods = existingMods.filter(
      (m) => m.enabled && m.kind === 'mod' && (duplicateAction !== 'replace' || m.uuid !== duplicateMod?.uuid)
    )

    const previewMeta = buildPartialMeta(
      modUuid,
      modName,
      modType,
      extractRoot,
      installOrder,
      folderName,
      filePath,
      isDir ? 'directory' : 'archive'
    )

    const conflicts = await checkConflicts(extractRoot, previewMeta, enabledMods)

    if (conflicts.length > 0 && !request.allowOverwriteConflicts) {
      // Clean up temp, return conflicts for user resolution
      fs.rmSync(tempDir, { recursive: true, force: true })
      sendProgress(win, 'Conflicts detected', 100)
      pushGeneralLog(win, {
        level: 'warn',
        source: 'install',
        message: `Install conflict detected: ${modName}`,
        details: {
          filePath,
          conflictCount: conflicts.length,
          conflicts,
        },
      })
      return {
        ok: true,
        data: {
          status: 'conflict',
          mod: previewMeta,
          conflicts,
        },
      }
    }

    sendProgress(win, 'Installing...', 97)

    // Move to library
    fs.mkdirSync(modDir, { recursive: true })
    const extractedFiles = listFilesRecursive(extractRoot)

    // Copy files from extractRoot to modDir
    copyDirSync(extractRoot, modDir)
    fs.rmSync(tempDir, { recursive: true, force: true })

    // Generate hashes for .archive files
    const hashes = await resolveHashes(modDir)
    const nexusRecord = findNexusDownloadRecordByPath(filePath)

    const meta: ModMetadata = {
      uuid: modUuid,
      name: modName,
      type: modType,
      kind: 'mod',
      order: installOrder,
      enabled: false,
      installedAt: new Date().toISOString(),
      sourceModifiedAt: getSourceModifiedAt(filePath),
      fileSize: getPathSizeSafe(modDir),
      files: extractedFiles,
      hashes,
      folderName,
      sourcePath: filePath,
      sourceType: isDir ? 'directory' : 'archive',
      nexusModId: nexusRecord?.modId,
      nexusFileId: nexusRecord?.fileId,
      version: nexusRecord?.version ?? extractVersionFromName(rawName),
    }

    // Write metadata
    fs.writeFileSync(
      path.join(modDir, '_metadata.json'),
      JSON.stringify(meta, null, 2),
      'utf-8'
    )

    sendProgress(win, 'Done', 100)
    pushGeneralLog(win, {
      level: 'info',
      source: 'install',
      message: `Install completed: ${meta.name}`,
      details: {
        modId: meta.uuid,
        filePath,
        folderName,
      },
    })
    return {
      ok: true,
      data: {
        status: 'installed',
        mod: meta,
        conflicts: [],
      },
    }
  } catch (err: unknown) {
    // Cleanup on failure
    fs.rmSync(tempDir, { recursive: true, force: true })
    if (modDir && fs.existsSync(modDir)) fs.rmSync(modDir, { recursive: true, force: true })
    pushGeneralLog(win, {
      level: 'error',
      source: 'install',
      message: `Install failed: ${normalizedName}`,
      details: buildErrorDetails(err, {
        filePath,
        targetModId,
      }),
    })
    return { ok: false, error: String(err) }
  }
}

function buildPartialMeta(
  uuid: string,
  name: string,
  type: ModMetadata['type'],
  dir: string,
  order: number,
  folderName: string,
  sourcePath: string,
  sourceType: ModMetadata['sourceType']
): ModMetadata {
  return {
    uuid,
    name,
    type,
    kind: 'mod',
    order,
    enabled: false,
    installedAt: new Date().toISOString(),
    sourceModifiedAt: getSourceModifiedAt(sourcePath),
    fileSize: getPathSizeSafe(dir),
    files: listFilesRecursive(dir),
    folderName,
    sourcePath,
    sourceType,
  }
}

async function checkConflicts(
  extractRoot: string,
  incomingMod: ModMetadata,
  enabledMods: ModMetadata[]
): Promise<ConflictInfo[]> {
  const conflicts: ConflictInfo[] = []
  const incomingDeployPaths = Array.from(
    new Set(getTrackedDeploymentPaths(incomingMod).map((value) => normalizeRelativePath(value)).filter(Boolean))
  )

  for (const mod of enabledMods) {
    const existingDeployPaths = new Set(
      getTrackedDeploymentPaths(mod).map((value) => normalizeRelativePath(value)).filter(Boolean)
    )

    for (const deployPath of incomingDeployPaths) {
      if (!existingDeployPaths.has(deployPath)) continue

      conflicts.push({
        kind: 'overwrite',
        resourcePath: deployPath.split(path.sep).join('/'),
        existingModId: mod.uuid,
        existingModName: mod.name,
        incomingModName: incomingMod.name,
        incomingModId: incomingMod.uuid,
        existingOrder: mod.order,
        incomingOrder: incomingMod.order,
        incomingWins: incomingMod.order > mod.order,
      })
    }
  }

  const incomingHashes = await resolveHashes(extractRoot)

  for (const mod of enabledMods) {
    if (!mod.hashes) continue
    for (const h of incomingHashes) {
      if (mod.hashes.includes(h)) {
        conflicts.push({
          kind: 'archive-resource',
          hash: h,
          resourcePath: h, // Will be resolved by hashResolver if DB is available
          existingModId: mod.uuid,
          existingModName: mod.name,
          incomingModName: incomingMod.name,
            incomingModId: incomingMod.uuid,
          existingOrder: mod.order,
          incomingOrder: incomingMod.order,
        })
      }
    }
  }

  return conflicts
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    const stat = fs.lstatSync(srcPath)
    if (stat.isSymbolicLink()) {
      continue
    }
    if (stat.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// ─── Handler Registration ─────────────────────────────────────────────────────

export function registerInstallerHandlers(getMainWindow: GetMainWindow): void {
  ipcMain.handle(
    IPC.INSTALL_MOD,
    async (_event, request: string | InstallModRequest) => {
      const settings = loadSettings()
      const win = getMainWindow()
      return installMod(request, settings, win)
    }
  )

  ipcMain.handle(
    IPC.REINSTALL_MOD,
    async (_event, modId: string): Promise<IpcResult<InstallModResponse>> => {
      const settings = loadSettings()
      const win = getMainWindow()
      const mods = await scanMods(settings.libraryPath)
      const mod = mods.find((item) => item.uuid === modId)

      if (!mod) return { ok: false, error: 'Mod not found' }
      if (!mod.sourcePath) return { ok: false, error: 'Original source path is not stored for this mod' }
      if (!fs.existsSync(mod.sourcePath)) {
        return { ok: false, error: 'Original source is no longer available' }
      }

      return installMod(
        {
          filePath: mod.sourcePath,
          duplicateAction: 'replace',
          targetModId: mod.uuid,
        },
        settings,
        win
      )
    }
  )
}
