import { ipcMain, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { path7za } from '7zip-bin'
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
import { loadSettings } from '../settings'
import { detectModType } from './archiveParser'
import { resolveHashes } from './hashResolver'
import { disableMod, findModDir, scanMods } from './modManager'
import { listFilesRecursive, getPathSizeSafe } from '../fileUtils'

type GetMainWindow = () => BrowserWindow | null

const SUPPORTED_EXTENSIONS = new Set(['.zip', '.7z', '.rar'])

function sendProgress(
  win: BrowserWindow | null,
  step: string,
  percent: number,
  currentFile?: string
): void {
  win?.webContents.send(IPC.INSTALL_PROGRESS, { step, percent, currentFile })
}

function countArchiveFiles(archivePath: string): Promise<number> {
  return new Promise((resolve) => {
    const args = ['l', '-ba', '-slt', archivePath]
    const proc = spawn(path7za, args)
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
  archivePath: string,
  destDir: string,
  totalFiles: number,
  onFile: (name: string, percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['x', archivePath, `-o${destDir}`, '-y', '-bb1', '-bd']
    const proc = spawn(path7za, args)
    let extracted = 0
    let buffer = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
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

    proc.stderr.on('data', () => { /* ignore stderr */ })

    proc.on('close', (code) => {
      if (code === 0 || code === null) resolve()
      else reject(new Error(`Extraction failed (exit code ${code})`))
    })

    proc.on('error', (err) => reject(new Error(`Could not start extractor: ${err.message}`)))
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
  const ext = path.extname(filePath).toLowerCase()
  const isDir = fs.statSync(filePath).isDirectory()

  if (!isDir && !SUPPORTED_EXTENSIONS.has(ext)) {
    return { ok: false, error: `Unsupported format: ${ext}. Supported: .zip, .7z, .rar` }
  }

  const rawName = isDir ? path.basename(filePath) : path.basename(filePath, ext)
  const normalizedName = normalizeModName(rawName)
  const folderBase = sanitizeFolderName(rawName)
  const tempDir = path.join(settings.libraryPath, `_tmp_${uuidv4()}`)
  let modDir = ''

  try {
    sendProgress(win, 'Preparing...', 5)
    fs.mkdirSync(tempDir, { recursive: true })

    if (isDir) {
      sendProgress(win, 'Copying files...', 10)
      copyDirSync(filePath, tempDir)
    } else {
      sendProgress(win, 'Reading archive...', 8)
      const totalFiles = await countArchiveFiles(filePath)
      await extractArchiveAsync(filePath, tempDir, totalFiles, (name, percent) => {
        sendProgress(win, 'Extracting...', percent, path.basename(name))
      })
    }

    sendProgress(win, 'Detecting mod type...', 95)

    // Flatten single-subfolder wrapping (common in mod archives)
    const tempContents = fs.readdirSync(tempDir)
    let extractRoot = tempDir
    if (tempContents.length === 1) {
      const single = path.join(tempDir, tempContents[0])
      if (fs.statSync(single).isDirectory()) {
        extractRoot = single
      }
    }

    const modType = detectModType(extractRoot)

    sendProgress(win, 'Checking for conflicts...', 96)

    // Detect conflicts using archive hashes
    const existingMods = await scanMods(settings.libraryPath)
    const duplicateMod = findDuplicateMod(existingMods, normalizedName, folderBase, targetModId)

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
        return removalResult
      }
    }

    const modName = duplicateAction === 'copy'
      ? uniqueDisplayName(existingMods, normalizedName)
      : duplicateMod?.name ?? normalizedName
    const folderName = duplicateAction === 'replace' && duplicateMod?.folderName
      ? duplicateMod.folderName
      : uniqueFolderName(settings.libraryPath, sanitizeFolderName(modName))
    modDir = path.join(settings.libraryPath, folderName)
    const enabledMods = existingMods.filter(
      (m) => m.enabled && m.kind === 'mod' && m.uuid !== duplicateMod?.uuid
    )

    const conflicts = await checkConflicts(extractRoot, modName, enabledMods, settings)

    if (conflicts.length > 0) {
      // Clean up temp, return conflicts for user resolution
      fs.rmSync(tempDir, { recursive: true, force: true })
      sendProgress(win, 'Conflicts detected', 100)
      return {
        ok: true,
        data: {
          status: 'conflict',
          mod: buildPartialMeta(
            duplicateMod?.uuid ?? uuidv4(),
            modName,
            modType,
            extractRoot,
            duplicateMod?.order ?? existingMods.length,
            folderName,
            filePath,
            isDir ? 'directory' : 'archive'
          ),
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

    const meta: ModMetadata = {
      uuid: (duplicateAction === 'replace' && duplicateMod?.uuid) ? duplicateMod.uuid : uuidv4(),
      name: modName,
      type: modType,
      kind: 'mod',
      order: duplicateMod?.order ?? existingMods.length,
      enabled: false,
      installedAt: new Date().toISOString(),
      sourceModifiedAt: getSourceModifiedAt(filePath),
      fileSize: getPathSizeSafe(modDir),
      files: extractedFiles,
      hashes,
      folderName,
      sourcePath: filePath,
      sourceType: isDir ? 'directory' : 'archive',
    }

    // Write metadata
    fs.writeFileSync(
      path.join(modDir, '_metadata.json'),
      JSON.stringify(meta, null, 2),
      'utf-8'
    )

    sendProgress(win, 'Done', 100)
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
  incomingName: string,
  enabledMods: ModMetadata[],
  settings: ReturnType<typeof loadSettings>
): Promise<ConflictInfo[]> {
  const incomingHashes = await resolveHashes(extractRoot)
  const conflicts: ConflictInfo[] = []

  for (const mod of enabledMods) {
    if (!mod.hashes) continue
    for (const h of incomingHashes) {
      if (mod.hashes.includes(h)) {
        conflicts.push({
          hash: h,
          resourcePath: h, // Will be resolved by hashResolver if DB is available
          existingModId: mod.uuid,
          existingModName: mod.name,
          incomingModName: incomingName
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
