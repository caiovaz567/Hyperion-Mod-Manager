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
  ArchiveResourceEntry,
  FomodInstallRequest,
  FomodFileEntry,
} from '../../shared/types'
import { pushGeneralLog, safeSendToWindow } from '../logStore'
import { loadSettings } from '../settings'
import { detectModType } from './archiveParser'
import {
  getArchiveResourceDisplayPath,
  getArchiveResourceIdentity,
  getArchiveResourceKeys,
  getStoredArchiveResources,
  resolveArchiveResources,
} from './hashResolver'
import { disableMod, findModDir, getTrackedDeploymentPaths, normalizeRelativePath, scanMods } from './modManager'
import { listFilesRecursive, getPathSizeSafe } from '../fileUtils'
import { findNexusDownloadRecordByPath } from '../nexusDownloadRegistry'

type GetMainWindow = () => BrowserWindow | null

const SUPPORTED_EXTENSIONS = new Set(['.zip', '.7z', '.rar'])
const PRESERVED_ARCHIVE_ROOT_DIRS = new Set(['archive', 'archives', 'bin', 'engine', 'mods', 'r6', 'red4ext'])
const ARCHIVE_RESOURCE_INDEX_VERSION = 3

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

/** Read a file and auto-detect common XML encodings (UTF-8/UTF-16LE/BE).
 *  Returns an empty string on error. */
function readTextFileAuto(filePath: string): string {
  try {
    const buf: Buffer = fs.readFileSync(filePath)

    // UTF-8 BOM
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      return buf.slice(3).toString('utf8')
    }

    // UTF-16 LE BOM
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
      return buf.slice(2).toString('utf16le')
    }

    // UTF-16 BE BOM — swap bytes then decode as utf16le
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
      const swapped = Buffer.allocUnsafe(buf.length - 2)
      for (let i = 2; i + 1 < buf.length; i += 2) {
        swapped[i - 2] = buf[i + 1]
        swapped[i - 1] = buf[i]
      }
      return swapped.toString('utf16le')
    }

    // Heuristic: UTF-16 LE without BOM — XML starts with '<' as bytes 0x3C 0x00
    if (buf.length >= 4 && buf[0] === 0x3C && buf[1] === 0x00) {
      return buf.toString('utf16le')
    }
    // Heuristic: UTF-16 BE without BOM — XML starts with '<' as bytes 0x00 0x3C
    if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x3C) {
      const swapped = Buffer.allocUnsafe(buf.length)
      for (let i = 0; i + 1 < buf.length; i += 2) {
        swapped[i] = buf[i + 1]
        swapped[i + 1] = buf[i]
      }
      return swapped.toString('utf16le')
    }

    // No BOM — try utf8 first, fall back to utf16le if replacement chars present
    let text = buf.toString('utf8')
    if (text.indexOf('\uFFFD') !== -1) {
      const maybe = buf.toString('utf16le')
      if (maybe.indexOf('\uFFFD') === -1) return maybe
      return buf.toString('latin1')
    }

    return text
  } catch {
    return ''
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
 * Scans the archive TOC (no extraction) and returns the in-archive path of
 * fomod/ModuleConfig.xml if one exists, or null if the archive has no FOMOD.
 */
function findFomodXmlPathInArchive(
  extractor: ArchiveExtractor,
  archivePath: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const args = ['l', '-ba', '-slt', archivePath]
    const proc = spawn(extractor.binPath, args, { windowsHide: true })
    let buffer = ''
    let resolved = false

    const check = () => {
      // Match any Path line whose last two path segments are fomod/ModuleConfig.xml
      const match = /^Path = ((?:.*[/\\])?fomod[/\\]ModuleConfig\.xml)\s*$/im.exec(buffer)
      if (match) {
        resolved = true
        proc.kill()
        resolve(match[1].replace(/\\/g, '/'))
      }
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      if (resolved) return
      buffer += chunk.toString()
      check()
    })

    proc.on('close', () => { if (!resolved) resolve(null) })
    proc.on('error', () => resolve(null))
  })
}

/**
 * Extracts a single file from an archive into destDir, preserving its
 * sub-directory structure as reported by 7z.
 */
function extractFileFromArchive(
  extractor: ArchiveExtractor,
  archivePath: string,
  destDir: string,
  fileInArchive: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['x', archivePath, `-o${destDir}`, `-i!${fileInArchive}`, '-y']
    const proc = spawn(extractor.binPath, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-2000) })
    proc.on('close', (code) => {
      if (code === 0 || code === null) resolve()
      else reject(new Error(`Single-file extract failed (${code}): ${stderr.slice(-200)}`))
    })
    proc.on('error', (err) => reject(new Error(`Extractor error: ${err.message}`)))
  })
}

/**
 * Extracts all files under a directory prefix from an archive (recursive),
 * preserving sub-directory structure. Used to extract the entire fomod/ folder
 * so images are available when the FOMOD wizard opens.
 */
function extractDirectoryFromArchive(
  extractor: ArchiveExtractor,
  archivePath: string,
  destDir: string,
  dirInArchive: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const prefix = dirInArchive.replace(/[/\\]+$/, '')
    const args = ['x', archivePath, `-o${destDir}`, `-i!${prefix}/*`, '-r', '-y']
    const proc = spawn(extractor.binPath, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-2000) })
    proc.on('close', (code) => {
      if (code === 0 || code === null) resolve()
      else reject(new Error(`Directory extract failed (${code}): ${stderr.slice(-200)}`))
    })
    proc.on('error', (err) => reject(new Error(`Extractor error: ${err.message}`)))
  })
}

/**
 * Extracts a list of specific files / patterns from an archive in a single
 * 7z call (recursive — patterns may match files at any depth). Files that
 * don't exist in the archive are silently skipped.
 */
function extractFilesFromArchive(
  extractor: ArchiveExtractor,
  archivePath: string,
  destDir: string,
  patternsInArchive: string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (patternsInArchive.length === 0) { resolve(); return }
    const includeArgs = patternsInArchive.map((f) => `-i!${f}`)
    const args = ['x', archivePath, `-o${destDir}`, ...includeArgs, '-r', '-y']
    const proc = spawn(extractor.binPath, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-2000) })
    proc.on('close', (code) => {
      // Code 1 means "warning" (e.g., some patterns matched nothing) — that's OK.
      if (code === 0 || code === 1 || code === null) resolve()
      else reject(new Error(`Multi-file extract failed (${code}): ${stderr.slice(-200)}`))
    })
    proc.on('error', (err) => reject(new Error(`Extractor error: ${err.message}`)))
  })
}

/**
 * Scans FOMOD XML for image references — `<image path="..."/>` and
 * `<moduleImage path="..."/>` — and returns the deduplicated list of paths.
 */
function extractFomodImagePaths(xml: string): string[] {
  const seen = new Set<string>()
  const re = /<(?:image|moduleImage)\s+[^>]*\bpath\s*=\s*["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const p = m[1]?.trim()
    if (p) seen.add(p)
  }
  return Array.from(seen)
}

function findFomodConfig(
  dir: string,
  maxDepth = 5
): { configPath: string; fomodRoot: string } | null {
  const configPath = path.join(dir, 'fomod', 'ModuleConfig.xml')
  if (fs.existsSync(configPath)) return { configPath, fomodRoot: dir }
  if (maxDepth <= 0) return null
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const found = findFomodConfig(path.join(dir, entry.name), maxDepth - 1)
      if (found) return found
    }
  } catch { /* ignore unreadable dirs */ }
  return null
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
      // ── Early FOMOD detection: scan archive TOC before extracting everything ──
      // This lets the FOMOD wizard appear immediately instead of waiting for the
      // full extraction, and avoids the React crash that the full-extraction path
      // could trigger when the dialog rendered while the install overlay was still
      // being torn down.
      const fomodXmlPath = await findFomodXmlPathInArchive(extractor, filePath)
      if (fomodXmlPath) {
        sendProgress(win, 'FOMOD installer detected', 8)
        let earlyOk = false
        try {
          // Extract the entire fomod/ directory so images stored alongside the XML are available.
          const fomodDirInArchive = fomodXmlPath.substring(0, fomodXmlPath.lastIndexOf('/'))
          await extractDirectoryFromArchive(extractor, filePath, tempDir, fomodDirInArchive)
          const fomodFound = findFomodConfig(tempDir)
          if (fomodFound) {
            let fomodXml = ''
            try { fomodXml = readTextFileAuto(fomodFound.configPath) } catch { /* fall through */ }
            if (fomodXml) {
              // Brute-force extract every common image type anywhere in the archive
              // alongside the XML-referenced ones. FOMOD images can live in many places
              // (fomod/images/, screenshots/, Images/, etc.) and the regex parser may
              // miss unusual XML formats — extracting all images is the safest catch-all
              // and is cheap because they're typically small thumbnails.
              const xmlImageCount = extractFomodImagePaths(fomodXml).length
              try {
                await extractFilesFromArchive(extractor, filePath, tempDir, [
                  '*.png', '*.jpg', '*.jpeg', '*.webp', '*.bmp', '*.gif',
                ])
              } catch { /* image extraction is best-effort */ }
              earlyOk = true
              pushGeneralLog(win, {
                level: 'info',
                source: 'install',
                message: `FOMOD package detected (early): ${normalizedName}`,
                details: {
                  filePath,
                  tempDir,
                  extractRoot: fomodFound.fomodRoot,
                  fomodDirInArchive,
                  xmlImageRefCount: xmlImageCount,
                },
              })
              // tempDir holds only the XML — full extraction happens in FOMOD_INSTALL
              return {
                ok: true,
                data: { status: 'fomod', fomod: { xml: fomodXml, tempDir, extractRoot: fomodFound.fomodRoot, needsExtraction: true } },
              }
            }
          }
        } catch { /* single-file extract failed — fall through to full extraction */ }

        if (!earlyOk) {
          // Clean up the partial mini-dir and reset for full extraction
          fs.rmSync(tempDir, { recursive: true, force: true })
          fs.mkdirSync(tempDir, { recursive: true })
        }
      }

      // Full extraction (either no FOMOD found, or early single-file extract failed)
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

    // Fallback FOMOD check after full extraction (covers edge cases where the archive
    // listing was unreliable or the early single-file extract failed).
    if (!isDir) {
      const fomodFound = findFomodConfig(tempDir)
      if (fomodFound) {
        let fomodXml = ''
        try { fomodXml = readTextFileAuto(fomodFound.configPath) } catch { /* fall through */ }
        if (fomodXml) {
          sendProgress(win, 'FOMOD configuration found', 96)
          pushGeneralLog(win, {
            level: 'info',
            source: 'install',
            message: `FOMOD package detected: ${normalizedName}`,
            details: { filePath, tempDir, extractRoot: fomodFound.fomodRoot },
          })
          // tempDir already has the full extraction — no needsExtraction
          return {
            ok: true,
            data: { status: 'fomod', fomod: { xml: fomodXml, tempDir, extractRoot: fomodFound.fomodRoot } },
          }
        }
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

    // Generate resource identities for .archive files.
    const archiveResources = await resolveArchiveResources(modDir)
    const hashes = archiveResources.map((resource) => resource.hash).filter((hash): hash is string => Boolean(hash))
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
      archiveResources,
      archiveResourceIndexVersion: ARCHIVE_RESOURCE_INDEX_VERSION,
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

function chooseArchiveResourceDisplay(
  incomingResource: ArchiveResourceEntry,
  existingResource: ArchiveResourceEntry
): ArchiveResourceEntry {
  return {
    hash: incomingResource.hash ?? existingResource.hash,
    resourcePath: incomingResource.resourcePath ?? existingResource.resourcePath,
    archivePath: incomingResource.archivePath ?? existingResource.archivePath,
  }
}

function buildArchiveResourceLookup(resources: ArchiveResourceEntry[]): Map<string, ArchiveResourceEntry> {
  const lookup = new Map<string, ArchiveResourceEntry>()

  for (const resource of resources) {
    for (const key of getArchiveResourceKeys(resource)) {
      if (!lookup.has(key)) lookup.set(key, resource)
    }
  }

  return lookup
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

  const incomingArchiveResources = await resolveArchiveResources(extractRoot)

  for (const mod of enabledMods) {
    const existingArchiveLookup = buildArchiveResourceLookup(getStoredArchiveResources(mod))
    if (existingArchiveLookup.size === 0) continue

    const seenArchiveConflicts = new Set<string>()
    for (const incomingResource of incomingArchiveResources) {
      const matchingKey = getArchiveResourceKeys(incomingResource).find((key) => existingArchiveLookup.has(key))
      if (!matchingKey) continue

      const existingResource = existingArchiveLookup.get(matchingKey)
      if (!existingResource) continue

      const displayResource = chooseArchiveResourceDisplay(incomingResource, existingResource)
      const identity = getArchiveResourceIdentity(displayResource, matchingKey)
      const conflictKey = `${mod.uuid}:${identity}`
      if (seenArchiveConflicts.has(conflictKey)) continue
      seenArchiveConflicts.add(conflictKey)

      const incomingWins = incomingMod.order > mod.order

      conflicts.push({
        kind: 'archive-resource',
        hash: displayResource.hash,
        resourcePath: getArchiveResourceDisplayPath(displayResource),
        existingModId: mod.uuid,
        existingModName: mod.name,
        incomingModName: incomingMod.name,
        incomingModId: incomingMod.uuid,
        existingOrder: mod.order,
        incomingOrder: incomingMod.order,
        incomingWins,
      })
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

async function installFromFomod(
  request: FomodInstallRequest,
  settings: ReturnType<typeof loadSettings>,
  win: BrowserWindow | null
): Promise<IpcResult<InstallModResponse>> {
  const {
    originalFilePath,
    installEntries,
    duplicateAction = 'prompt',
    targetModId,
    needsExtraction,
  } = request

  // tempDir and extractRoot may be updated below when needsExtraction is true
  let tempDir = request.tempDir
  let extractRoot = request.extractRoot

  const ext = path.extname(originalFilePath).toLowerCase()
  const rawName = path.basename(originalFilePath, ext) || path.basename(originalFilePath)
  const normalizedName = normalizeModName(rawName)
  let modDir = ''
  // Tracks a fullTempDir created during needsExtraction so we can clean it up on error
  // if the tempDir switch hasn't happened yet.
  let pendingFullTempDir: string | null = null

  try {
    if (needsExtraction) {
      // The early-detection path only extracted the FOMOD XML.  Do the full
      // extraction now so copyFomodEntries can read the selected source files.
      const fullTempDir = path.join(settings.libraryPath, `_tmp_fomod_${uuidv4()}`)
      pendingFullTempDir = fullTempDir
      fs.mkdirSync(fullTempDir, { recursive: true })

      sendProgress(win, 'Extracting mod files...', 5)
      const archiveExtractor = resolveArchiveExtractor(ext)
      const totalFiles = await countArchiveFiles(archiveExtractor, originalFilePath)
      await extractArchiveAsync(archiveExtractor, originalFilePath, fullTempDir, totalFiles, (name, percent) => {
        sendProgress(win, 'Extracting...', 5 + Math.round(percent * 0.45), name.replace(/\\/g, '/'))
      })

      const fomodInFull = findFomodConfig(fullTempDir)
      if (!fomodInFull) {
        fs.rmSync(fullTempDir, { recursive: true, force: true })
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }
        return { ok: false, error: 'FOMOD configuration not found in the extracted archive' }
      }

      // Switch over: clean up the mini XML-only dir, use the full extraction
      try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }
      pendingFullTempDir = null  // now owned by tempDir below
      tempDir = fullTempDir
      extractRoot = fomodInFull.fomodRoot
    }

    sendProgress(win, 'Preparing FOMOD install...', needsExtraction ? 55 : 10)

    const existingMods = await scanMods(settings.libraryPath)
    const duplicateMod = findDuplicateMod(existingMods, normalizedName, sanitizeFolderName(rawName), targetModId)
    const nextInstallOrder = getNextInstallOrder(existingMods)
    const installOrder = duplicateAction === 'replace'
      ? (duplicateMod?.order ?? existingMods.length)
      : duplicateAction === 'copy' && duplicateMod
        ? getInstallOrderForCopy(existingMods, duplicateMod)
        : nextInstallOrder

    if (duplicateMod && duplicateAction === 'prompt') {
      fs.rmSync(tempDir, { recursive: true, force: true })
      sendProgress(win, 'Duplicate mod detected', 100)
      return {
        ok: true,
        data: {
          status: 'duplicate',
          duplicate: {
            existingModId: duplicateMod.uuid,
            existingModName: duplicateMod.name,
            incomingModName: normalizedName,
            sourcePath: originalFilePath,
          },
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

    // Copy selected files into a staging dir so we can run type/conflict detection before committing
    const stagingDir = path.join(tempDir, '_fomod_staging')
    fs.mkdirSync(stagingDir, { recursive: true })

    sendProgress(win, 'Copying selected files...', 30)
    copyFomodEntries(installEntries, extractRoot, stagingDir)

    sendProgress(win, 'Detecting mod type...', 60)
    const modType = detectModType(stagingDir)

    const enabledMods = existingMods.filter(
      (m) => m.enabled && m.kind === 'mod' && (duplicateAction !== 'replace' || m.uuid !== duplicateMod?.uuid)
    )

    const previewMeta = buildPartialMeta(
      modUuid, modName, modType, stagingDir, installOrder, folderName, originalFilePath, 'archive'
    )

    sendProgress(win, 'Checking for conflicts...', 70)
    const conflicts = await checkConflicts(stagingDir, previewMeta, enabledMods)

    if (conflicts.length > 0 && !request.allowOverwriteConflicts) {
      // Keep tempDir alive so the renderer can retry — only clean staging
      fs.rmSync(stagingDir, { recursive: true, force: true })
      sendProgress(win, 'Conflicts detected', 100)
      return { ok: true, data: { status: 'conflict', mod: previewMeta, conflicts } }
    }

    sendProgress(win, 'Installing...', 85)

    modDir = path.join(settings.libraryPath, folderName)
    copyDirSync(stagingDir, modDir)
    fs.rmSync(tempDir, { recursive: true, force: true })

    sendProgress(win, 'Indexing resources...', 92)
    const archiveResources = await resolveArchiveResources(modDir)
    const hashes = archiveResources.map((r) => r.hash).filter((h): h is string => Boolean(h))
    const nexusRecord = findNexusDownloadRecordByPath(originalFilePath)

    const meta: ModMetadata = {
      uuid: modUuid,
      name: modName,
      type: modType,
      kind: 'mod',
      order: installOrder,
      enabled: false,
      installedAt: new Date().toISOString(),
      sourceModifiedAt: getSourceModifiedAt(originalFilePath),
      fileSize: getPathSizeSafe(modDir),
      files: listFilesRecursive(modDir),
      hashes,
      archiveResources,
      archiveResourceIndexVersion: ARCHIVE_RESOURCE_INDEX_VERSION,
      folderName,
      sourcePath: originalFilePath,
      sourceType: 'archive',
      nexusModId: nexusRecord?.modId,
      nexusFileId: nexusRecord?.fileId,
      version: nexusRecord?.version ?? extractVersionFromName(rawName),
    }

    fs.writeFileSync(path.join(modDir, '_metadata.json'), JSON.stringify(meta, null, 2), 'utf-8')

    sendProgress(win, 'Done', 100)
    pushGeneralLog(win, {
      level: 'info',
      source: 'install',
      message: `FOMOD install completed: ${meta.name}`,
      details: { modId: meta.uuid, filePath: originalFilePath, folderName },
    })
    return { ok: true, data: { status: 'installed', mod: meta, conflicts: [] } }
  } catch (err) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }
    // If extraction failed before we could switch tempDir, clean up the full dir too
    if (pendingFullTempDir) {
      try { fs.rmSync(pendingFullTempDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
    if (modDir && fs.existsSync(modDir)) {
      try { fs.rmSync(modDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
    pushGeneralLog(win, {
      level: 'error',
      source: 'install',
      message: `FOMOD install failed: ${normalizedName}`,
      details: buildErrorDetails(err, { filePath: originalFilePath }),
    })
    return { ok: false, error: String(err) }
  }
}

function copyFomodEntries(entries: FomodFileEntry[], extractRoot: string, destDir: string): void {
  for (const entry of entries) {
    const normalizedSource = entry.source.replace(/\\/g, '/')
    const normalizedDest = entry.destination.replace(/\\/g, '/')
    const srcPath = path.join(extractRoot, normalizedSource)

    if (!fs.existsSync(srcPath)) continue

    if (entry.type === 'folder') {
      const destPath = normalizedDest ? path.join(destDir, normalizedDest) : destDir
      copyDirSync(srcPath, destPath)
    } else {
      const destFileName = normalizedDest || path.basename(normalizedSource)
      const destPath = path.join(destDir, destFileName)
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
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
    IPC.FOMOD_INSTALL,
    async (_event, request: FomodInstallRequest) => {
      const settings = loadSettings()
      const win = getMainWindow()
      return installFromFomod(request, settings, win)
    }
  )

  ipcMain.handle(
    IPC.FOMOD_CANCEL,
    async (_event, tempDir: string) => {
      if (tempDir && typeof tempDir === 'string') {
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }
      }
      return { ok: true }
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
