import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import type { AppSettings } from '../shared/types'
import type { PathDefaults } from '../shared/types'

const settingsPath = path.join(app.getPath('userData'), 'settings.json')

function getManagedRoot(): string {
  return path.join(app.getPath('documents'), 'Hyperion')
}

function normalizePerModChoices(
  rawChoices?: Partial<Record<string, 'replace' | 'copy' | 'none'>>,
): Record<string, 'replace' | 'copy'> {
  if (!rawChoices) return {}

  return Object.fromEntries(
    Object.entries(rawChoices).filter((entry): entry is [string, 'replace' | 'copy'] =>
      entry[1] === 'replace' || entry[1] === 'copy'
    )
  )
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

function normalizeLibraryColumnWidths(raw?: AppSettings['libraryColumnWidths']): AppSettings['libraryColumnWidths'] {
  if (!raw) return undefined
  const entries = Object.entries(raw).filter((entry): entry is [keyof NonNullable<AppSettings['libraryColumnWidths']>, number] =>
    typeof entry[1] === 'number' && Number.isFinite(entry[1])
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/**
 * The directory Hyperion is installed into. Only meaningful for packaged builds;
 * during `npm run dev` the executable is Electron under node_modules, so we fall back
 * to the Documents managed root.
 */
export function getInstallDir(): string | null {
  if (!app.isPackaged) return null
  try {
    return path.dirname(app.getPath('exe'))
  } catch {
    return null
  }
}

/**
 * Suggested data locations. By design these live INSIDE the Hyperion install directory
 * (a `Mods` and `Downloads` folder beside the executable) for a self-contained, portable
 * layout. This is only safe because the NSIS uninstaller is surgical — it removes only
 * Hyperion's own files (see build/installer.nsh + scripts/after-pack.cjs), so updating or
 * uninstalling never touches these folders or any other user content placed alongside the app.
 * In dev (unpackaged) we fall back to Documents/Hyperion so we never scatter files in node_modules.
 */
export function getPathDefaults(): PathDefaults {
  const root = getInstallDir() ?? getManagedRoot()
  return {
    libraryPath: path.join(root, 'Mods'),
    downloadPath: path.join(root, 'Downloads')
  }
}

function normalizeSettings(raw?: Partial<AppSettings>): AppSettings {
  const defaults = getPathDefaults()
  const hasLibraryPath = Boolean(raw && Object.prototype.hasOwnProperty.call(raw, 'libraryPath'))
  const hasDownloadPath = Boolean(raw && Object.prototype.hasOwnProperty.call(raw, 'downloadPath'))
  const hasSetupCompleted = Boolean(raw && Object.prototype.hasOwnProperty.call(raw, 'setupCompleted'))
  const libraryPath = hasLibraryPath ? (raw?.libraryPath?.trim() ?? '') : defaults.libraryPath
  const gamePath = raw?.gamePath?.trim() ?? ''
  // Migration: settings files written before the `setupCompleted` flag existed are
  // treated as already-onboarded when they carry a game path, so existing users are
  // never pushed back through the wizard. New writes always persist the flag, so a
  // freshly auto-detected (but unconfirmed) game path keeps `setupCompleted: false`.
  const setupCompleted = hasSetupCompleted ? Boolean(raw?.setupCompleted) : gamePath.length > 0
  return {
    gamePath,
    libraryPath,
    downloadPath: hasDownloadPath
      ? (raw?.downloadPath?.trim() || getDownloadPathFromLibrary(libraryPath) || defaults.downloadPath)
      : (getDownloadPathFromLibrary(libraryPath) || defaults.downloadPath),
    theme: 'dark',
    autoUpdate: raw?.autoUpdate ?? true,
    autoInstallDownloads: raw?.autoInstallDownloads ?? true,
    nexusApiKey: raw?.nexusApiKey ?? '',
    libraryColumnWidths: normalizeLibraryColumnWidths(raw?.libraryColumnWidths),
    collapsedLibrarySeparatorIds: Array.isArray(raw?.collapsedLibrarySeparatorIds)
      ? raw.collapsedLibrarySeparatorIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    autoInstallPerMod: normalizePerModChoices(raw?.autoInstallPerMod),
    setupCompleted,
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
