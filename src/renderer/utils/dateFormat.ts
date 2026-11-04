import type { SystemDateFormat } from '../../shared/types'

// Set once at boot from the main process. Until then, and on systems with no
// readable format, dates follow the default locale.
let systemFormat: SystemDateFormat | null = null

export function setSystemDateFormat(format: SystemDateFormat | null): void {
  systemFormat = format
}

// Windows date and time picture tokens. Quoted text is literal.
const PATTERN_TOKEN = /'[^']*'|d{1,4}|M{1,4}|y+|g+|H{1,2}|h{1,2}|m{1,2}|s{1,2}|t{1,2}/g

const pad = (value: number): string => String(value).padStart(2, '0')

function formatName(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale || undefined, options).format(date)
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date)
  }
}

function formatPattern(date: Date, pattern: string, format: SystemDateFormat): string {
  const hours = date.getHours()
  const hours12 = hours % 12 || 12
  const period = hours < 12 ? format.am : format.pm

  return pattern.replace(PATTERN_TOKEN, (token) => {
    switch (token) {
      case 'd': return String(date.getDate())
      case 'dd': return pad(date.getDate())
      case 'ddd': return formatName(date, format.locale, { weekday: 'short' })
      case 'dddd': return formatName(date, format.locale, { weekday: 'long' })
      case 'M': return String(date.getMonth() + 1)
      case 'MM': return pad(date.getMonth() + 1)
      case 'MMM': return formatName(date, format.locale, { month: 'short' })
      case 'MMMM': return formatName(date, format.locale, { month: 'long' })
      case 'y': return String(date.getFullYear() % 10)
      case 'yy': return pad(date.getFullYear() % 100)
      case 'H': return String(hours)
      case 'HH': return pad(hours)
      case 'h': return String(hours12)
      case 'hh': return pad(hours12)
      case 'm': return String(date.getMinutes())
      case 'mm': return pad(date.getMinutes())
      case 's': return String(date.getSeconds())
      case 'ss': return pad(date.getSeconds())
      case 't': return period.slice(0, 1)
      case 'tt': return period
    }
    if (token.startsWith("'")) return token.slice(1, -1)
    if (token.startsWith('y')) return String(date.getFullYear())
    return '' // Era markers (g, gg) add nothing on the Gregorian calendar.
  })
}

export function formatWindowsDateTime(value?: string): string {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  if (systemFormat?.shortDate && systemFormat.time) {
    const datePart = formatPattern(date, systemFormat.shortDate, systemFormat)
    const timePart = formatPattern(date, systemFormat.time, systemFormat)
    return `${datePart} ${timePart}`.replace(/\s+/g, ' ').trim()
  }

  return formatName(date, systemFormat?.locale ?? '', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).replace(', ', ' ')
}

export function formatWindowsDateTimeOrFallback(value: string | undefined, fallback: string): string {
  if (!value) return fallback

  const formatted = formatWindowsDateTime(value)
  return formatted === '-' ? fallback : formatted
}
