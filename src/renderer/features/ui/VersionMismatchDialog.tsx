import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store/useAppStore'
import { useTranslation } from '../../i18n/I18nContext'

type VersionRelation = 'upgrade' | 'downgrade' | 'different' | 'unknown'
type MismatchAction = 'replace' | 'copy' | 'skip'
type OptionAccent = 'cyan' | 'yellow' | 'neutral'

function tokenizeVersion(value?: string): string[] {
  if (!value) return []
  return value
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
}

function compareVersionTokens(left?: string, right?: string): number | null {
  const leftTokens = tokenizeVersion(left)
  const rightTokens = tokenizeVersion(right)
  if (!leftTokens.length || !rightTokens.length) return null

  const length = Math.max(leftTokens.length, rightTokens.length)
  for (let index = 0; index < length; index += 1) {
    const leftToken = leftTokens[index] ?? '0'
    const rightToken = rightTokens[index] ?? '0'
    const leftNumber = Number(leftToken)
    const rightNumber = Number(rightToken)
    const bothNumeric = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)

    if (bothNumeric) {
      if (leftNumber === rightNumber) continue
      return leftNumber < rightNumber ? -1 : 1
    }

    if (leftToken === rightToken) continue
    return leftToken.localeCompare(rightToken)
  }

  return 0
}

function getVersionRelation(existingVersion?: string, incomingVersion?: string): VersionRelation {
  const comparison = compareVersionTokens(existingVersion, incomingVersion)
  if (comparison === null) return 'unknown'
  if (comparison < 0) return 'upgrade'
  if (comparison > 0) return 'downgrade'
  return 'different'
}

function formatVersionLabel(version: string | undefined, unknownLabel: string): string {
  return version ? `v${version}` : unknownLabel
}

const ACCENT_STYLES: Record<OptionAccent, { text: string; card: string; badge: string }> = {
  cyan: {
    text: 'text-[#4FD8FF]',
    card: 'border-[#4FD8FF]/30 bg-[#0b1418] hover:border-[#4FD8FF]/60',
    badge: 'border-[#4FD8FF]/40 text-[#4FD8FF]',
  },
  yellow: {
    text: 'text-[#fcee09]',
    card: 'border-[#fcee09]/30 bg-[#14130a] hover:border-[#fcee09]/60',
    badge: 'border-[#fcee09]/40 text-[#fcee09]',
  },
  neutral: {
    text: 'text-[var(--text-primary)]',
    card: 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]',
    badge: '',
  },
}

interface OptionConfig {
  action: MismatchAction
  icon: string
  title: string
  helper: string
  accent: OptionAccent
  recommended?: boolean
}

interface OptionCardProps extends OptionConfig {
  disabled: boolean
  onSelect: (action: MismatchAction) => void
}

const OptionCard: React.FC<OptionCardProps> = ({
  action,
  icon,
  title,
  helper,
  accent,
  recommended,
  disabled,
  onSelect,
}) => {
  const { t } = useTranslation()
  const style = ACCENT_STYLES[accent]
  return (
    <button
      onClick={() => onSelect(action)}
      disabled={disabled}
      className={`group flex w-full items-start gap-3 rounded-sm border-[0.5px] px-4 py-3.5 text-left transition-colors duration-150 disabled:opacity-60 ${style.card}`}
    >
      <span className={`material-symbols-outlined mt-[2px] shrink-0 text-[20px] ${style.text}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={`brand-font text-[0.9rem] font-bold uppercase tracking-[0.04em] ${style.text}`}>
            {title}
          </span>
          {recommended ? (
            <span
              className={`shrink-0 rounded-sm border-[0.5px] bg-black/20 px-2 py-[2px] text-[9px] brand-font font-bold uppercase tracking-[0.16em] ${style.badge}`}
            >
              {t('dialogs.version.recommended')}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-[var(--text-secondary)]">
          {helper}
        </span>
      </span>
    </button>
  )
}

export const VersionMismatchDialog: React.FC = () => {
  const { t } = useTranslation()
  const {
    versionMismatchPrompt,
    confirmVersionMismatch,
    clearVersionMismatchPrompt,
  } = useAppStore((state) => ({
    versionMismatchPrompt: state.versionMismatchPrompt,
    confirmVersionMismatch: state.confirmVersionMismatch,
    clearVersionMismatchPrompt: state.clearVersionMismatchPrompt,
  }))

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!versionMismatchPrompt) {
      setSubmitting(false)
    }
  }, [versionMismatchPrompt])

  const relation = useMemo<VersionRelation>(
    () => getVersionRelation(versionMismatchPrompt?.existingVersion, versionMismatchPrompt?.incomingVersion),
    [versionMismatchPrompt?.existingVersion, versionMismatchPrompt?.incomingVersion]
  )

  if (!versionMismatchPrompt) return null

  const unknownLabel = t('dialogs.version.unknown')
  const existingLabel = formatVersionLabel(versionMismatchPrompt.existingVersion, unknownLabel)
  const incomingLabel = formatVersionLabel(versionMismatchPrompt.incomingVersion, unknownLabel)
  const isDowngrade = relation === 'downgrade'

  const headerMeta = {
    upgrade: { badge: t('dialogs.version.badgeNewer'), summary: t('dialogs.version.summaryUpgrade') },
    downgrade: { badge: t('dialogs.version.badgeOlder'), summary: t('dialogs.version.summaryDowngrade') },
    different: { badge: t('dialogs.version.badgeDifferent'), summary: t('dialogs.version.summaryDifferent') },
    unknown: { badge: t('dialogs.version.badgeReview'), summary: t('dialogs.version.summaryUnknown') },
  }[relation]

  const accentColor = isDowngrade ? 'var(--status-error)' : 'var(--accent-cyber-blue)'
  const accentGlow = isDowngrade ? '0 0 12px rgba(248,113,113,0.24)' : '0 0 12px rgba(79,216,255,0.24)'
  const badgeStyle = isDowngrade
    ? { borderColor: 'rgba(248,113,113,0.45)', background: 'rgba(248,113,113,0.08)', color: 'var(--status-error)' }
    : { borderColor: 'rgba(79,216,255,0.45)', background: 'rgba(79,216,255,0.08)', color: 'var(--accent-cyber-blue)' }

  // Two primary options, uniform across cases: the recommended outcome on top, then the
  // always-available "add as a separate copy" path. The risky/secondary action lives in
  // the understated footer so the safe choice stays visually dominant.
  const options: OptionConfig[] = isDowngrade
    ? [
        {
          action: 'skip',
          icon: 'check_circle',
          title: t('dialogs.version.keep', { version: existingLabel }),
          helper: t('dialogs.version.keepHelper'),
          accent: 'yellow',
          recommended: true,
        },
        {
          action: 'copy',
          icon: 'library_add',
          title: t('dialogs.version.addToLibrary'),
          helper: t('dialogs.version.addToLibraryHelper'),
          accent: 'neutral',
        },
      ]
    : [
        {
          action: 'replace',
          icon: 'upgrade',
          title: relation === 'upgrade' ? t('dialogs.version.updateTo', { version: incomingLabel }) : t('dialogs.version.switchTo', { version: incomingLabel }),
          helper: t('dialogs.version.replaceHelper'),
          accent: 'cyan',
          recommended: relation === 'upgrade',
        },
        {
          action: 'copy',
          icon: 'library_add',
          title: t('dialogs.version.addToLibrary'),
          helper: t('dialogs.version.addToLibraryHelper'),
          accent: 'neutral',
        },
      ]

  const footer = isDowngrade
    ? { action: 'replace' as const, label: t('dialogs.version.replaceOlder', { version: incomingLabel }), danger: true }
    : { action: 'skip' as const, label: t('dialogs.version.notNow'), danger: false }

  const doAction = async (action: MismatchAction) => {
    setSubmitting(true)
    try {
      await confirmVersionMismatch(action)
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-center justify-center overflow-hidden bg-black/82 px-4 py-5 backdrop-blur-sm sm:px-5">
      <div className="relative mx-auto w-full max-w-[480px] overflow-hidden border-[0.5px] border-[var(--border-strong)] bg-[var(--bg-base)] px-5 py-5 shadow-[0_20px_50px_rgba(0,0,0,0.82)] sm:px-6 sm:py-6">
        <div
          className="absolute left-0 top-0 h-[2px] w-full"
          style={{ background: accentColor, boxShadow: accentGlow }}
        />

        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[22px]" style={{ color: accentColor }}>
              difference
            </span>
            <h2
              className="brand-font text-[1.05rem] font-bold uppercase tracking-[0.06em]"
              style={{ color: 'var(--text-primary)' }}
            >
              {t('dialogs.version.title')}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className="inline-flex items-center rounded-sm border-[0.5px] px-2.5 py-1 text-[10px] brand-font font-bold uppercase tracking-[0.16em]"
              style={badgeStyle}
            >
              {headerMeta.badge}
            </span>
            <button
              onClick={() => {
                if (submitting) return
                clearVersionMismatchPrompt()
              }}
              disabled={submitting}
              aria-label={t('common.close')}
              className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] border-[var(--border-default)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-[var(--text-secondary)]">
          {headerMeta.summary}
        </p>

        <div className="mb-5 rounded-sm border-[0.5px] border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3.5">
          <div className="mb-3 truncate text-sm font-medium text-[var(--text-primary)]">
            {versionMismatchPrompt.existingModName}
          </div>
          <div className="flex items-end gap-4 font-mono">
            <div className="min-w-0">
              <div className="text-[1.4rem] font-semibold leading-none text-[var(--text-secondary)]">
                {existingLabel}
              </div>
              <div className="ui-support-mono mt-1.5 uppercase tracking-[0.14em] text-[var(--text-support)]">
                {t('dialogs.version.installed')}
              </div>
            </div>
            <span className="material-symbols-outlined pb-[18px] text-[20px] text-[var(--text-muted)]">
              arrow_forward
            </span>
            <div className="min-w-0">
              <div className="text-[1.4rem] font-semibold leading-none" style={{ color: accentColor }}>
                {incomingLabel}
              </div>
              <div className="ui-support-mono mt-1.5 uppercase tracking-[0.14em] text-[var(--text-support)]">
                {t('dialogs.version.selected')}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-4 grid gap-2.5">
          {options.map((option) => (
            <OptionCard
              key={option.action}
              {...option}
              disabled={submitting}
              onSelect={doAction}
            />
          ))}
        </div>

        <button
          onClick={() => {
            if (submitting) return
            void doAction(footer.action)
          }}
          disabled={submitting}
          className={`w-full rounded-sm border-[0.5px] border-[var(--border-default)] py-2 text-[10px] brand-font font-bold uppercase tracking-[0.18em] transition-colors hover:border-[var(--border-strong)] disabled:opacity-60 ${
            footer.danger
              ? 'text-[var(--status-error)]/70 hover:text-[var(--status-error)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          {footer.label}
        </button>
      </div>
    </div>,
    document.body
  )
}

export default VersionMismatchDialog
