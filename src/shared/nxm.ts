import type { NxmLinkPayload } from './types'

const GAME_DOMAIN = 'cyberpunk2077'

function normalizeNxmUrl(raw: string): string {
  return raw.trim().replace(/^"+|"+$/g, '')
}

export function parseNxmUrl(raw: string): NxmLinkPayload | null {
  try {
    const normalizedRaw = normalizeNxmUrl(raw)
    const url = new URL(normalizedRaw)
    if (url.protocol.toLowerCase() !== 'nxm:') return null

    const host = url.hostname.trim().toLowerCase()
    const segments = url.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)

    let gameDomain = host

    if (!gameDomain && segments[0]) {
      gameDomain = segments.shift()!.toLowerCase()
    } else if (segments[0]?.toLowerCase() === gameDomain) {
      segments.shift()
    }

    if (gameDomain !== GAME_DOMAIN) return null
    if (segments.length < 4 || segments[0] !== 'mods' || segments[2] !== 'files') return null

    const modId = parseInt(segments[1], 10)
    const fileId = parseInt(segments[3], 10)
    const key = url.searchParams.get('key') ?? ''
    const expires = parseInt(url.searchParams.get('expires') ?? '0', 10)
    const userId = parseInt(url.searchParams.get('userId') ?? url.searchParams.get('user_id') ?? '0', 10)

    if (!Number.isFinite(modId) || modId <= 0 || !Number.isFinite(fileId) || fileId <= 0) {
      return null
    }

    return {
      modId,
      fileId,
      key,
      expires: Number.isFinite(expires) ? expires : 0,
      userId: Number.isFinite(userId) ? userId : 0,
      raw: normalizedRaw,
    }
  } catch {
    return null
  }
}