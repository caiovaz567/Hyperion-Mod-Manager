import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IPC, type GameLaunchProgress } from '@shared/types'
import { IpcService } from '../../services/IpcService'
import { useTranslation } from '../../i18n/I18nContext'
import type { TranslationKey } from '../../i18n/I18nContext'
import { Icon } from './Icon'

const AUTO_HIDE_DONE_MS = 2600
const AUTO_HIDE_CANCELLED_MS = 2000

// Known step keys sent by the main process (game:launchProgress). Unknown keys
// fall back to the untranslated English `step` text so a new main-side step can
// never render a missing-key placeholder.
const STEP_LABEL_KEYS: Record<string, TranslationKey> = {
  scan: 'launch.step.scan',
  map: 'launch.step.map',
  bridge: 'launch.step.bridge',
  overwrite: 'launch.step.overwrite',
  bootstrap: 'launch.step.bootstrap',
  mount: 'launch.step.mount',
  redmod: 'launch.step.redmod',
  launch: 'launch.step.launch',
}

// Floating, non-blocking status card for the game-launch pipeline (VFS mount,
// REDmod compile, hooked start). The main process has always emitted these
// progress events; before this card the renderer dropped them and the user only
// saw the sidebar button spinning on "Launching...".
export const LaunchProgressCard: React.FC = () => {
  const { t, tn } = useTranslation()
  const [progress, setProgress] = useState<GameLaunchProgress | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const hideTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const unsubscribe = IpcService.on(IPC.LAUNCH_GAME_PROGRESS, (...args) => {
      const next = args[0] as GameLaunchProgress
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
      setProgress(next)
      if (next.state === 'running' || next.state === undefined) return

      setCancelling(false)
      if (next.state === 'done' || next.state === 'cancelled') {
        hideTimerRef.current = window.setTimeout(
          () => {
            hideTimerRef.current = null
            setProgress(null)
          },
          next.state === 'done' ? AUTO_HIDE_DONE_MS : AUTO_HIDE_CANCELLED_MS
        )
      }
      // 'error' stays visible until dismissed.
    })
    return () => {
      unsubscribe()
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    }
  }, [])

  if (!progress) return null

  const state = progress.state ?? 'running'
  const isRunning = state === 'running'
  const isError = state === 'error'
  const title = state === 'done'
    ? t('launch.step.launched')
    : state === 'cancelled'
      ? t('launch.step.cancelled')
      : isError
        ? t('launch.step.error')
        : cancelling
          ? t('launch.step.cancelling')
          : (progress.key && STEP_LABEL_KEYS[progress.key] ? t(STEP_LABEL_KEYS[progress.key]) : progress.step)
  const tone = isError
    ? { tile: 'bg-[rgba(248,113,113,0.14)] text-[var(--status-error)]', bar: 'bg-[var(--status-error)]' }
    : state === 'done'
      ? { tile: 'bg-[rgba(52,211,153,0.14)] text-[#34D399]', bar: 'bg-[#34D399]' }
      : { tile: 'bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--accent)]', bar: 'bg-[var(--accent)]' }
  const percent = Math.min(Math.max(progress.percent, 0), 100)
  // REDmod's live log lines take over the detail slot as soon as the tool starts
  // talking; until any output exists, show the translated "first launch can take
  // minutes" hint so the wait never reads as a hang.
  const detail = progress.detailKey === 'launchedDetail'
    ? tn('launch.step.launchedDetail', Number(progress.detailVars?.count ?? 0))
    : progress.key === 'redmod' && isRunning && !progress.detail
      ? t('launch.step.redmodHint')
      : progress.detail

  const handleCancel = async () => {
    setCancelling(true)
    await IpcService.invoke(IPC.CANCEL_GAME_LAUNCH).catch(() => undefined)
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[150] flex justify-center px-6">
      <div className="fade-up pointer-events-auto flex w-[min(600px,100%)] items-center gap-3.5 rounded-2xl border border-[var(--border)] bg-[var(--overlay)] px-4 py-3.5">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone.tile}`}>
          {isRunning ? (
            <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <Icon
              name={isError ? 'error' : state === 'cancelled' ? 'close' : 'check_circle'}
              className="text-[18px]"
            />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            {/* Never truncate: this card exists to tell the user exactly what is
                happening - long step titles/details wrap instead of ellipsizing. */}
            <span className="min-w-0 break-words text-[13.5px] font-semibold leading-snug text-[var(--text-primary)]">{title}</span>
            {isRunning ? (
              <span className="shrink-0 text-[13px] tabular-nums text-[var(--text-muted)]">{percent}%</span>
            ) : null}
          </div>
          {detail ? (
            <div className="mt-0.5 break-words text-[12.5px] leading-snug text-[var(--text-support)]">{detail}</div>
          ) : null}
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
            <span
              className={`block h-full rounded-full transition-[width] duration-300 ease-out ${tone.bar}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {isRunning && progress.cancellable && !cancelling ? (
          <button
            type="button"
            onClick={() => void handleCancel()}
            className="shrink-0 rounded-lg bg-[var(--surface-secondary)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[rgba(248,113,113,0.14)] hover:text-[var(--status-error)]"
          >
            {t('common.cancel')}
          </button>
        ) : null}
        {isError ? (
          <button
            type="button"
            onClick={() => setProgress(null)}
            aria-label={t('common.close')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-secondary)] text-[var(--text-support)] transition-colors hover:text-[var(--text-primary)]"
          >
            <Icon name="close" className="text-[15px]" />
          </button>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
