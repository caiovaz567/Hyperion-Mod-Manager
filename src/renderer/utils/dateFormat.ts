export function formatWindowsDateTime(value?: string): string {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function formatWindowsDateTimeOrFallback(value: string | undefined, fallback: string): string {
  if (!value) return fallback

  const formatted = formatWindowsDateTime(value)
  return formatted === '—' ? fallback : formatted
}
