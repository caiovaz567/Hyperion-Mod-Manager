import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@heroui/react'
import { useAppStore } from '../../store/useAppStore'
import { HyperionModal } from './HyperionPrimitives'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from './Icon'

type VersionRelation = 'upgrade' | 'downgrade' | 'different' | 'unknown'
type MismatchAction = 'replace' | 'copy' | 'skip'
type OptionAccent = 'accent' | 'neutral'

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
  accent: {
    text: 'text-[var(--accent)]',
    card: 'border-[rgb(var(--accent-rgb)/0.35)] bg-[rgb(var(--accent-rgb)/0.06)] hover:border-[rgb(var(--accent-rgb)/0.6)] hover:bg-[rgb(var(--accent-rgb)/0.1)]',
    badge: 'bg-[rgb(var(--accent-rgb)/0.16)] text-[var(--accent)]',
  },
  neutral: {
    text: 'text-[var(--text-primary)]',
    card: 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-secondary)]',
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
      className={`group flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors duration-150 disabled:opacity-60 ${style.card}`}
    >
      <Icon name={icon} className={`mt-[2px] shrink-0 text-[20px] ${style.text}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={`text-[0.92rem] font-semibold tracking-[-0.01em] ${style.text}`}>
            {title}
          </span>
          {recommended ? (
            <span
              className={`shrink-0 rounded-md px-2 py-[2px] text-[9px] font-bold uppercase tracking-[0.14em] ${style.badge}`}
            >
              {t('dialogs.version.recommended')}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-[15px] leading-relaxed text-[var(--text-secondary)]">
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

  const accentColor = isDowngrade ? 'var(--status-error)' : 'var(--accent)'
  const badgeClass = isDowngrade
    ? 'bg-[rgb(248_113_113/0.12)] text-[var(--status-error)]'
    : 'bg-[rgb(var(--accent-rgb)/0.14)] text-[var(--accent)]'

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
          accent: 'accent',
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
          accent: 'accent',
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

  return (
    <HyperionModal
      onClose={() => { if (!submitting) clearVersionMismatchPrompt() }}
      surfaceClassName="max-w-[480px]"
    >
      <div className="px-6 py-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${badgeClass}`}>
              <Icon name="difference" className="text-[20px]" />
            </span>
            <h2 className="text-[1.05rem] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              {t('dialogs.version.title')}
            </h2>
          </div>
          <span className={`inline-flex shrink-0 items-center rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${badgeClass}`}>
            {headerMeta.badge}
          </span>
        </div>

        <p className="mb-4 text-[15px] leading-relaxed text-[var(--text-secondary)]">
          {headerMeta.summary}
        </p>

        <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
          <div className="mb-3 truncate text-[15px] font-medium text-[var(--text-primary)]">
            {versionMismatchPrompt.existingModName}
          </div>
          <div className="flex items-end gap-4">
            <div className="min-w-0">
              <div className="text-[1.4rem] font-semibold leading-none text-[var(--text-secondary)]">
                {existingLabel}
              </div>
              <div className="mt-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--text-support)]">
                {t('dialogs.version.installed')}
              </div>
            </div>
            <Icon name="arrow_forward" className="pb-[18px] text-[20px] text-[var(--text-muted)]" />
            <div className="min-w-0">
              <div className="text-[1.4rem] font-semibold leading-none" style={{ color: accentColor }}>
                {incomingLabel}
              </div>
              <div className="mt-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--text-support)]">
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

        <Button
          variant="ghost"
          onPress={() => { if (!submitting) void doAction(footer.action) }}
          isDisabled={submitting}
          className={`w-full ${footer.danger ? 'text-[var(--status-error)]' : ''}`}
        >
          {footer.label}
        </Button>
      </div>
    </HyperionModal>
  )
}

export default VersionMismatchDialog
