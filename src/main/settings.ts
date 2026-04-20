import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import type { AppSettings } from '../shared/types'
import type { PathDefaults } from '../shared/types'

const settingsPath = path.join(app.getPath('userData'), 'settings.json')

function getManagedRoot(): string {
  return path.join(app.getPath('documents'), 'Hyperion')
}

function getDownloadPathFromLibrary(libraryPath?: string): string {
  const normalizedLibraryPath = libraryPath?.trim()
  if (!normalizedLibraryPath) {
    return path.join(getManagedRoot(), 'Downloads')
  }

  const libraryParent = path.dirname(normalizedLibraryPath)
  if (!libraryParent || libraryParent === normalizedLibraryPath) {
    return path.join(getManagedRoot(), 'Downloads')
  }

  return path.join(libraryParent, 'Downloads')
}

export function getPathDefaults(): PathDefaults {
  const managedRoot = getManagedRoot()
  return {
    libraryPath: path.join(managedRoot, 'Mod Library'),
    downloadPath: path.join(managedRoot, 'Downloads')
  }
}

function normalizeSettings(raw?: Partial<AppSettings>): AppSettings {
  const defaults = getPathDefaults()
  const hasLibraryPath = Boolean(raw && Object.prototype.hasOwnProperty.call(raw, 'libraryPath'))
  const hasDownloadPath = Boolean(raw && Object.prototype.hasOwnProperty.call(raw, 'downloadPath'))
  const libraryPath = hasLibraryPath ? (raw?.libraryPath?.trim() ?? '') : defaults.libraryPath
  return {
    gamePath: raw?.gamePath?.trim() ?? '',
    libraryPath,
    downloadPath: hasDownloadPath
      ? (raw?.downloadPath?.trim() || getDownloadPathFromLibrary(libraryPath) || defaults.downloadPath)
      : (getDownloadPathFromLibrary(libraryPath) || defaults.downloadPath),
    theme: 'dark',
    autoUpdate: raw?.autoUpdate ?? true,
    nexusApiKey: raw?.nexusApiKey ?? '',
  }
}

function ensureManagedDirectories(settings: AppSettings): void {
  for (const targetPath of [settings.libraryPath, settings.downloadPath]) {
    if (!targetPath?.trim()) continue
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true })
    }
  }
}

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8')
      const parsed = normalizeSettings(JSON.parse(raw) as Partial<AppSettings>)
      ensureManagedDirectories(parsed)
      return parsed
    }
  } catch {
    // Fall through to defaults
  }
  const defaults = normalizeSettings()
  ensureManagedDirectories(defaults)
  return defaults
}

export function saveSettings(settings: AppSettings): void {
  const normalized = normalizeSettings(settings)
  ensureManagedDirectories(normalized)
  const dir = path.dirname(settingsPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(normalized, null, 2), 'utf-8')
}
