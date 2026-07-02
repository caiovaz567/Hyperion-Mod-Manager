import React from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from './Icon'

const SEVERITY_CONFIG = {
  success: { color: 'var(--status-success)', icon: 'check_circle' },
  error:   { color: 'var(--status-error)',   icon: 'error' },
  warning: { color: 'var(--status-warning)', icon: 'warning' },
  info:    { color: 'var(--status-info)',     icon: 'info' },
} as const

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useAppStore()
  const { t } = useTranslation()

  return (
    <div className="pointer-events-none fixed bottom-9 right-4 z-[9999] flex flex-col items-end gap-2">
      {toasts.map((toast) => {
        const cfg = SEVERITY_CONFIG[toast.severity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.info
        return (
          <div
            key={toast.id}
            className="fade-up pointer-events-auto relative flex min-w-[360px] max-w-[460px] items-center gap-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--overlay)] px-4 py-3 shadow-[0_12px_44px_rgba(0,0,0,0.5)]"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-[3px]"
              style={{ background: cfg.color, boxShadow: `0 0 10px ${cfg.color}66` }}
            />
            <Icon name={cfg.icon} className="shrink-0 text-[18px]" style={{ color: cfg.color }} />
            <span className="flex-1 pr-1 text-[0.92rem] leading-[1.45] text-[var(--text-primary-alt)]">
              {toast.message}
            </span>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label={t('common.close')}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[rgb(248_113_113/0.1)] hover:text-[var(--status-error)]"
            >
              <Icon name="close" className="text-[16px]" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
