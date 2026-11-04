import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { app } from 'electron'
import type { SystemDateFormat } from '../shared/types'

const execFileAsync = promisify(execFile)

const INTERNATIONAL_KEY = 'HKCU\\Control Panel\\International'
const REG_VALUE_LINE = /^"([^"]+)"="((?:[^"\\]|\\.)*)"$/

/**
 * Reads the user's date and time format out of a `reg export` of the
 * International key. Returns null when the formats are missing, so the caller
 * can fall back to the system locale.
 */
export function parseInternationalRegExport(text: string): SystemDateFormat | null {
  const values = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = REG_VALUE_LINE.exec(line)
    if (match) values.set(match[1], match[2].replace(/\\(.)/g, '$1'))
  }

  const shortDate = values.get('sShortDate')?.trim()
  const time = values.get('sTimeFormat')?.trim()
  if (!shortDate || !time) return null

  return {
    locale: values.get('LocaleName') ?? '',
    shortDate,
    time,
    am: values.get('s1159') ?? '',
    pm: values.get('s2359') ?? '',
  }
}

/**
 * The Windows date and time format the user configured, custom formats included.
 * Uses `reg export` instead of `reg query` because the export is always UTF-16:
 * `reg query` prints in the console code page, which garbles non-ASCII text such
 * as the Bulgarian `d.M.yyyy 'г.'`.
 */
export async function readSystemDateFormat(): Promise<SystemDateFormat> {
  const fallback: SystemDateFormat = { locale: app.getSystemLocale(), shortDate: '', time: '', am: '', pm: '' }
  if (process.platform !== 'win32') return fallback

  const exportPath = path.join(app.getPath('temp'), `hyperion-international-${process.pid}.reg`)
  try {
    await execFileAsync('reg', ['export', INTERNATIONAL_KEY, exportPath, '/y'], { windowsHide: true, timeout: 5000 })
    const text = fs.readFileSync(exportPath).toString('utf16le').replace(/^﻿/, '')
    return parseInternationalRegExport(text) ?? fallback
  } catch {
    return fallback
  } finally {
    fs.rmSync(exportPath, { force: true })
  }
}
