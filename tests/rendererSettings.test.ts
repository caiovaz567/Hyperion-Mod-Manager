import { describe, expect, it } from 'vitest'
import { toRendererSettings } from '../src/main/settings'
import type { AppSettings } from '../src/shared/types'

const base: AppSettings = {
  gamePath: 'C:\\Games\\Cyberpunk 2077',
  libraryPath: 'C:\\Hyperion\\Mods',
  downloadPath: 'C:\\Hyperion\\Downloads',
  autoUpdate: true,
  autoInstallDownloads: true,
  nexusApiKey: '',
}

describe('toRendererSettings', () => {
  it('never lets the Nexus API key cross to the renderer', () => {
    const key = 'abcdEFGH1234secretKEYvalue--wxyz'
    const safe = toRendererSettings({ ...base, nexusApiKey: key })
    expect(safe.nexusApiKey).toBe('')
    expect(JSON.stringify(safe)).not.toContain(key)
    expect(JSON.stringify(safe)).not.toContain('secretKEY')
  })

  it('describes a stored key with a stable fingerprint', () => {
    const a = toRendererSettings({ ...base, nexusApiKey: 'first-key-aaaa' })
    const again = toRendererSettings({ ...base, nexusApiKey: 'first-key-aaaa' })
    const b = toRendererSettings({ ...base, nexusApiKey: 'other-key-aaaa' })
    expect(a.nexusApiKeyId).toMatch(/^[0-9a-f]{12}$/)
    expect(again.nexusApiKeyId).toBe(a.nexusApiKeyId)
    expect(b.nexusApiKeyId).not.toBe(a.nexusApiKeyId)
  })

  it('reports no key when none is stored', () => {
    const safe = toRendererSettings(base)
    expect(safe.nexusApiKeyId).toBe('')
  })

  it('keeps every other setting intact', () => {
    const safe = toRendererSettings({ ...base, nexusApiKey: 'k-1234', language: 'pt-BR' })
    expect(safe.gamePath).toBe(base.gamePath)
    expect(safe.libraryPath).toBe(base.libraryPath)
    expect(safe.language).toBe('pt-BR')
  })
})
