import { afterEach, describe, expect, it } from 'vitest'
import { formatWindowsDateTime, formatWindowsDateTimeOrFallback, setSystemDateFormat } from '../src/renderer/utils/dateFormat'
import { parseInternationalRegExport } from '../src/main/systemDateFormat'

const evening = new Date(2026, 10, 2, 23, 3, 7).toISOString()
const morning = new Date(2026, 0, 9, 8, 5, 4).toISOString()
const midnightHalf = new Date(2026, 0, 9, 0, 30, 0).toISOString()

function useFormat(shortDate: string, time: string, locale = 'en-US', am = 'AM', pm = 'PM') {
  setSystemDateFormat({ locale, shortDate, time, am, pm })
}

afterEach(() => setSystemDateFormat(null))

describe('formatWindowsDateTime', () => {
  it('follows a day-first 24-hour format', () => {
    useFormat('dd/MM/yyyy', 'HH:mm:ss', 'pt-BR', '', '')
    expect(formatWindowsDateTime(evening)).toBe('02/11/2026 23:03:07')
  })

  it('follows a month-first 12-hour format without leading zeros', () => {
    useFormat('M/d/yyyy', 'h:mm:ss tt')
    expect(formatWindowsDateTime(evening)).toBe('11/2/2026 11:03:07 PM')
    expect(formatWindowsDateTime(morning)).toBe('1/9/2026 8:05:04 AM')
  })

  it('shows midnight as 12 on a 12-hour clock', () => {
    useFormat('M/d/yyyy', 'hh:mm tt')
    expect(formatWindowsDateTime(midnightHalf)).toBe('1/9/2026 12:30 AM')
  })

  it('follows a custom year-first format', () => {
    useFormat('yyyy-MM-dd', 'HH.mm.ss')
    expect(formatWindowsDateTime(morning)).toBe('2026-01-09 08.05.04')
  })

  it('shortens the year and writes month names in the Windows locale', () => {
    useFormat('dd-MMM-yy', 'H:mm', 'en-US')
    expect(formatWindowsDateTime(morning)).toBe('09-Jan-26 8:05')
  })

  it('keeps quoted text as written', () => {
    useFormat("d.M.yyyy 'г.'", 'HH:mm', 'bg-BG')
    expect(formatWindowsDateTime(morning)).toBe('9.1.2026 г. 08:05')
  })

  it('leaves no stray space when the 12-hour marker is empty', () => {
    useFormat('M/d/yyyy', 'h:mm tt', 'en-US', '', '')
    expect(formatWindowsDateTime(morning)).toBe('1/9/2026 8:05')
  })

  it('falls back to the locale when Windows gave no pattern', () => {
    setSystemDateFormat({ locale: 'de-DE', shortDate: '', time: '', am: '', pm: '' })
    expect(formatWindowsDateTime(morning)).toBe('09.01.2026 08:05:04')
  })

  it('survives an invalid locale', () => {
    useFormat('MMM', 'H', 'not a locale!')
    expect(formatWindowsDateTime(morning)).toContain('8')
  })

  it('handles missing and invalid values', () => {
    expect(formatWindowsDateTime(undefined)).toBe('-')
    expect(formatWindowsDateTime('not a date')).toBe('-')
    expect(formatWindowsDateTimeOrFallback('not a date', 'never')).toBe('never')
  })
})

describe('parseInternationalRegExport', () => {
  it('reads the format values from a registry export', () => {
    const text = [
      'Windows Registry Editor Version 5.00',
      '',
      '[HKEY_CURRENT_USER\\Control Panel\\International]',
      '"LocaleName"="bg-BG"',
      '"s1159"="AM"',
      '"s2359"=""',
      '"sShortDate"="d.M.yyyy \'г.\'"',
      '"sTimeFormat"="H:mm:ss"',
      '"iCountry"=dword:00000001',
    ].join('\r\n')

    expect(parseInternationalRegExport(text)).toEqual({
      locale: 'bg-BG',
      shortDate: "d.M.yyyy 'г.'",
      time: 'H:mm:ss',
      am: 'AM',
      pm: '',
    })
  })

  it('unescapes quotes and backslashes', () => {
    const text = '"sShortDate"="dd\\\\MM\\"yy"\n"sTimeFormat"="HH:mm"'
    expect(parseInternationalRegExport(text)?.shortDate).toBe('dd\\MM"yy')
  })

  it('returns null when a format is missing', () => {
    expect(parseInternationalRegExport('"sShortDate"="dd/MM/yyyy"')).toBeNull()
    expect(parseInternationalRegExport('')).toBeNull()
  })
})
