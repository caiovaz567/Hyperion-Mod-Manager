import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC } from '../../shared/types'
import type { IpcResult } from '../../shared/types'

// Cyberpunk 2077 GOG game ID
const CP2077_GOG_ID = '1423049645'

// Common Steam app ID for Cyberpunk 2077
const CP2077_STEAM_ID = '1091500'

const COMMON_PATHS = [
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077',
  'C:\\Program Files\\Steam\\steamapps\\common\\Cyberpunk 2077',
  'D:\\Steam\\steamapps\\common\\Cyberpunk 2077',
  'D:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077',
  'C:\\GOG Games\\Cyberpunk 2077',
  'D:\\GOG Games\\Cyberpunk 2077',
  'C:\\Program Files\\GOG Galaxy\\Games\\Cyberpunk 2077',
  'C:\\Epic Games\\Cyberpunk2077',
  'C:\\Program Files\\Epic Games\\Cyberpunk2077',
  'D:\\Epic Games\\Cyberpunk2077'
]

const GAME_EXECUTABLE = 'bin\\x64\\Cyberpunk2077.exe'

function isValidGamePath(p: string): boolean {
  return fs.existsSync(path.join(p, GAME_EXECUTABLE))
}

function isValidLibraryPath(targetPath?: string): boolean {
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

/**
 * Tries to detect the game installation via Windows Registry.
 */
function tryRegistry(): string | null {
  if (process.platform !== 'win32') return null

  try {
    // Dynamic require to avoid issues on non-Windows
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('child_process')

    // Try GOG registry key
    try {
      const gogPath = execSync(
        `reg query "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\${CP2077_GOG_ID}" /v path`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      )
      const match = gogPath.match(/path\s+REG_SZ\s+(.+)/)
      if (match) {
        const p = match[1].trim()
        console.log(`[GameDetector] Testing GOG path: ${p}`)
        if (isValidGamePath(p)) {
          console.log(`[GameDetector] GOG path valid: ${p}`)
          return p
        }
      }
    } catch { /* GOG not found */ }

    // Try Steam registry key
    try {
      const steamInstall = execSync(
        'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      )
      const match = steamInstall.match(/InstallPath\s+REG_SZ\s+(.+)/)
      if (match) {
        const steamRoot = match[1].trim()
        const steamappsPath = path.join(
          steamRoot,
          'steamapps',
          'common',
          'Cyberpunk 2077'
        )
        console.log(`[GameDetector] Testing Steam main path: ${steamappsPath}`)
        if (isValidGamePath(steamappsPath)) {
          console.log(`[GameDetector] Steam main path valid: ${steamappsPath}`)
          return steamappsPath
        }

        // Check additional Steam library folders from VDF
        const vdfPath = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf')
        if (fs.existsSync(vdfPath)) {
          console.log(`[GameDetector] Scanning Steam library folders from: ${vdfPath}`)
          const vdf = fs.readFileSync(vdfPath, 'utf-8')
          const pathMatches = vdf.matchAll(/"path"\s+"([^"]+)"/g)
          for (const pm of pathMatches) {
            const libPath = path.join(
              pm[1],
              'steamapps',
              'common',
              'Cyberpunk 2077'
            )
            console.log(`[GameDetector] Testing Steam library path: ${libPath}`)
            if (isValidGamePath(libPath)) {
              console.log(`[GameDetector] Steam library path valid: ${libPath}`)
              return libPath
            }
          }
        }
      }
    } catch (e) {
      console.log(`[GameDetector] Steam registry search failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  } catch (e) {
    console.log(`[GameDetector] Registry unavailable: ${e instanceof Error ? e.message : String(e)}`)
  }

  return null
}

/**
 * Searches common installation paths.
 */
function tryCommonPaths(): string | null {
  for (const p of COMMON_PATHS) {
    console.log(`[GameDetector] Testing common path: ${p}`)
    if (isValidGamePath(p)) {
      console.log(`[GameDetector] Common path valid: ${p}`)
      return p
    }
  }
  return null
}

/**
 * Dynamically detect all available drive letters on Windows.
 */
function getAvailableDrives(): string[] {
  if (process.platform !== 'win32') return []

  const drives: string[] = []
  // Check drives A-Z
  for (let i = 65; i <= 90; i++) {
    const drive = `${String.fromCharCode(i)}:\\`
    if (fs.existsSync(drive)) {
      drives.push(drive)
    }
  }
  return drives
}

/**
 * Search for Cyberpunk 2077 in steamapps\common directories across all drives.
 */
function trySearchSteamappsCommon(): string | null {
  if (process.platform !== 'win32') return null

  const drives = getAvailableDrives()
  console.log(`[GameDetector] Available drives: ${drives.join(', ')}`)

  for (const drive of drives) {
    // Look for any steamapps\common\Cyberpunk 2077 path
    const searchPatterns = [
      path.join(drive, 'steamapps', 'common', 'Cyberpunk 2077'),
      path.join(drive, 'SteamLibrary', 'steamapps', 'common', 'Cyberpunk 2077'),
      path.join(drive, 'Steam', 'steamapps', 'common', 'Cyberpunk 2077'),
    ]

    for (const pattern of searchPatterns) {
      console.log(`[GameDetector] Testing steamapps path: ${pattern}`)
      if (isValidGamePath(pattern)) {
        console.log(`[GameDetector] Steamapps path valid: ${pattern}`)
        return pattern
      }
    }

    // Fallback: scan root directories on this drive for steamapps\common
    try {
      const rootDirs = fs.readdirSync(drive, { withFileTypes: true })
      for (const entry of rootDirs) {
        if (!entry.isDirectory()) continue

        const steamappsPath = path.join(drive, entry.name, 'steamapps', 'common', 'Cyberpunk 2077')
        console.log(`[GameDetector] Testing drive-scanned steamapps path: ${steamappsPath}`)
        if (isValidGamePath(steamappsPath)) {
          console.log(`[GameDetector] Drive-scanned steamapps path valid: ${steamappsPath}`)
          return steamappsPath
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  return null
}

/**
 * Fallback: search for Cyberpunk 2077 in common drive roots with limited depth.
 */
function tryBreadthSearchFromRoots(): string | null {
  if (process.platform !== 'win32') return null

  const drives = getAvailableDrives()
  const searchDirs = ['Program Files', 'Program Files (x86)', 'Games', 'GOG Games', 'Epic Games', 'Games', 'Modding']

  for (const drive of drives) {
    if (!fs.existsSync(drive)) continue

    for (const searchDir of searchDirs) {
      const candidatePath = path.join(drive, searchDir, 'Cyberpunk 2077')
      console.log(`[GameDetector] Testing breadth-search path: ${candidatePath}`)
      if (isValidGamePath(candidatePath)) {
        console.log(`[GameDetector] Breadth-search path valid: ${candidatePath}`)
        return candidatePath
      }

      // For Program Files-like dirs, also check subdirectories (e.g., "Program Files/SomeStore/Cyberpunk 2077")
      try {
        const parentPath = path.join(drive, searchDir)
        if (fs.existsSync(parentPath)) {
          const subdirs = fs.readdirSync(parentPath, { withFileTypes: true })
          for (const subdir of subdirs) {
            if (!subdir.isDirectory()) continue
            const subCandidate = path.join(parentPath, subdir.name, 'Cyberpunk 2077')
            console.log(`[GameDetector] Testing breadth-search subpath: ${subCandidate}`)
            if (isValidGamePath(subCandidate)) {
              console.log(`[GameDetector] Breadth-search subpath valid: ${subCandidate}`)
              return subCandidate
            }
          }
        }
      } catch {
        // Ignore permission errors, etc.
      }
    }
  }

  return null
}

export function registerGameDetectorHandlers(): void {
  ipcMain.handle(
    IPC.DETECT_GAME,
    async (): Promise<IpcResult<string>> => {
      console.log('[GameDetector] Starting game detection...')

      // 1. Registry first (most reliable on Windows)
      const fromRegistry = tryRegistry()
      if (fromRegistry) {
        console.log(`[GameDetector] Detection succeeded via registry: ${fromRegistry}`)
        return { ok: true, data: fromRegistry }
      }

      // 2. Common paths fallback
      const fromCommon = tryCommonPaths()
      if (fromCommon) {
        console.log(`[GameDetector] Detection succeeded via common paths: ${fromCommon}`)
        return { ok: true, data: fromCommon }
      }

      // 3. Search steamapps\common across all drives (important for custom Steam library paths)
      const fromSteamapps = trySearchSteamappsCommon()
      if (fromSteamapps) {
        console.log(`[GameDetector] Detection succeeded via steamapps search: ${fromSteamapps}`)
        return { ok: true, data: fromSteamapps }
      }

      // 4. Breadth search fallback
      const fromBreadth = tryBreadthSearchFromRoots()
      if (fromBreadth) {
        console.log(`[GameDetector] Detection succeeded via breadth search: ${fromBreadth}`)
        return { ok: true, data: fromBreadth }
      }

      console.log('[GameDetector] Detection failed: Cyberpunk 2077 installation not found')
      return { ok: false, error: 'Cyberpunk 2077 installation not found' }
    }
  )

  ipcMain.handle(
    IPC.VALIDATE_GAME_PATH,
    async (_event, gamePath?: string): Promise<IpcResult<boolean>> => {
      if (!gamePath?.trim()) return { ok: true, data: false }
      const trimmedPath = gamePath.trim()
      const isValid = isValidGamePath(trimmedPath)
      console.log(`[GameDetector] VALIDATE_GAME_PATH: ${trimmedPath} => ${isValid}`)
      return { ok: true, data: isValid }
    }
  )

  ipcMain.handle(
    IPC.VALIDATE_LIBRARY_PATH,
    async (_event, libraryPath?: string): Promise<IpcResult<boolean>> => {
      return { ok: true, data: isValidLibraryPath(libraryPath) }
    }
  )
}
