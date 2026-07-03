// Loader + typed surface for the native usvfs-bridge addon.
//
// The addon (and usvfs_x64.dll next to it) is built by `npm run build:native`
// into native/usvfs-bridge/build/Release in dev, and bundled to
// usvfs in packaged builds (see electron-builder extraResources).
//
// If the addon is missing or fails to load, loadVfsBridge() returns null and
// getVfsBridgeDiagnostics() explains which runtime paths were tried.

import path from 'path'
import fs from 'fs'
import { app } from 'electron'

export interface VfsLink {
  source: string
  dest: string
  /** When true, link the directory tree recursively (creates virtual folders). */
  dir?: boolean
  /** When true, redirect file creation/writes in `dest` to `source` (overwrite). */
  createTarget?: boolean
}

export interface MountResult {
  ok: boolean
  linked?: number
  failed?: number
  stage?: string
  gle?: number
}

export interface LaunchResult {
  ok: boolean
  pid?: number
  exitCode?: number
  stdout?: string
  stage?: string
  gle?: number
}

export interface UsvfsBridge {
  usvfsVersion(): string
  mountVfs(opts: {
    instanceName?: string
    links: VfsLink[]
    blacklistExecutables?: string[]
  }): MountResult
  launchHookedProcess(opts: {
    appPath?: string
    commandLine: string
    cwd?: string
    capture?: boolean
    waitMs?: number
  }): LaunchResult
  unmountVfs(): { ok: boolean }
  dumpVfsTree?(): string
  vfsProcesses?(): number[]
}

export interface VfsBridgeDiagnostics {
  available: boolean
  platform: NodeJS.Platform
  packaged: boolean
  attemptedPaths: string[]
  loadedPath?: string
  error?: string
}

// Bypass the bundler's static require analysis - this is a runtime-only,
// platform-specific native binary that must not be inlined by electron-vite.
const runtimeRequire: NodeRequire = eval('require')

function resolveAddonPaths(): string[] {
  if (app.isPackaged) {
    return [
      path.join(process.resourcesPath, 'usvfs', 'usvfs_bridge.node'),
      // Backward-compatible with older builds that used extraResources.to =
      // "resources/usvfs", which lands under resources/resources/usvfs.
      path.join(process.resourcesPath, 'resources', 'usvfs', 'usvfs_bridge.node'),
    ]
  }
  return [
    path.join(
      app.getAppPath(),
      'native',
      'usvfs-bridge',
      'build',
      'Release',
      'usvfs_bridge.node'
    ),
  ]
}

let cached: UsvfsBridge | null | undefined
let cachedDiagnostics: VfsBridgeDiagnostics | undefined

export function loadVfsBridge(): UsvfsBridge | null {
  if (cached !== undefined) return cached
  const attemptedPaths = resolveAddonPaths()
  cachedDiagnostics = {
    available: false,
    platform: process.platform,
    packaged: app.isPackaged,
    attemptedPaths,
  }

  if (process.platform !== 'win32') {
    cachedDiagnostics.error = 'usvfs is only available on Windows'
    cached = null
    return cached
  }

  const existingPaths = attemptedPaths.filter((candidate) => {
    try {
      return fs.existsSync(candidate)
    } catch {
      return false
    }
  })

  if (existingPaths.length === 0) {
    cachedDiagnostics.error = 'usvfs bridge addon was not found'
    cached = null
    return cached
  }

  let lastError = ''
  for (const addonPath of existingPaths) {
    try {
      cached = runtimeRequire(addonPath) as UsvfsBridge
      cachedDiagnostics = {
        ...cachedDiagnostics,
        available: true,
        loadedPath: addonPath,
        error: undefined,
      }
      return cached
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  cachedDiagnostics.error = lastError || 'usvfs bridge addon failed to load'
  cached = null
  return cached
}

export function getVfsBridgeDiagnostics(): VfsBridgeDiagnostics {
  if (cached === undefined) loadVfsBridge()
  return cachedDiagnostics ?? {
    available: false,
    platform: process.platform,
    packaged: app.isPackaged,
    attemptedPaths: resolveAddonPaths(),
    error: 'usvfs bridge has not been initialized',
  }
}

export function isVfsAvailable(): boolean {
  return loadVfsBridge() !== null
}
