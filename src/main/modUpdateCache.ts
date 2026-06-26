import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { ModUpdateCache } from '../shared/types'

// Nexus update statuses are cached here (userData) rather than renderer localStorage,
// because in dev the renderer's sessionData is namespaced per process id and is wiped
// on every restart. A main-process file survives restarts in both dev and packaged
// builds, so cached update indicators (and the last-check timestamp that drives the
// adaptive `updated.json` window) persist as intended.

const EMPTY_CACHE: ModUpdateCache = { statuses: {}, checkedAt: null }

function getCachePath(): string {
  return path.join(app.getPath('userData'), 'mod-update-cache.json')
}

export function loadModUpdateCache(): ModUpdateCache {
  try {
    const cachePath = getCachePath()
    if (!fs.existsSync(cachePath)) return { ...EMPTY_CACHE }
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as Partial<ModUpdateCache>
    const statuses =
      parsed.statuses && typeof parsed.statuses === 'object' ? parsed.statuses : {}
    const checkedAt = typeof parsed.checkedAt === 'string' ? parsed.checkedAt : null
    return { statuses, checkedAt }
  } catch {
    return { ...EMPTY_CACHE }
  }
}

export function saveModUpdateCache(cache: ModUpdateCache): void {
  try {
    const cachePath = getCachePath()
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    const statuses = cache?.statuses && typeof cache.statuses === 'object' ? cache.statuses : {}
    const checkedAt = typeof cache?.checkedAt === 'string' ? cache.checkedAt : null
    fs.writeFileSync(cachePath, JSON.stringify({ statuses, checkedAt }, null, 2), 'utf-8')
  } catch {
    /* best-effort — the cache is a performance aid, not source of truth */
  }
}
