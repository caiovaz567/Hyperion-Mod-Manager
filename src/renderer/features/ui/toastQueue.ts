import { ToastQueue } from '@heroui/react'
import type { ToastSeverity } from '@shared/types'

// Single global HeroUI toast queue. The store's `addToast` action pushes here and
// `ToastContainer` renders it through HeroUI's <ToastProvider>, so every call site
// keeps the same API while the toasts themselves are real HeroUI components.
export const hyperionToastQueue = new ToastQueue({ maxVisibleToasts: 5 })

// Hyperion severities → HeroUI toast variants. `info` uses the accent variant so
// informational toasts follow the user's chosen color, like the rest of the app.
const SEVERITY_VARIANT: Record<ToastSeverity, 'success' | 'danger' | 'warning' | 'accent'> = {
  success: 'success',
  error: 'danger',
  warning: 'warning',
  info: 'accent',
}

export function pushHeroToast(message: string, severity: ToastSeverity = 'info', duration = 4000): void {
  hyperionToastQueue.add(
    { title: message, variant: SEVERITY_VARIANT[severity] ?? 'accent' },
    { timeout: duration }
  )
}
