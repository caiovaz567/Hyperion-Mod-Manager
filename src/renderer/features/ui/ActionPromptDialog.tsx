import React from 'react'
import { Button } from '@heroui/react'
import { HyperionModal } from './HyperionPrimitives'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from './Icon'

type ActionPromptTone = 'accent' | 'danger'

interface ActionPromptDialogProps {
  /** Primary-action color language. 'accent' follows the selected accent; 'danger' is semantic red. */
  tone?: ActionPromptTone
  title: string
  description: string
  detailLabel?: string
  detailValue?: string
  icon: string
  primaryLabel: string
  secondaryLabel?: string
  cancelLabel?: string
  onPrimary: () => void
  onSecondary?: () => void
  onCancel: () => void
  submitting?: boolean
  detailContent?: React.ReactNode
  maxWidthClassName?: string
}

export const ActionPromptDialog: React.FC<ActionPromptDialogProps> = ({
  tone = 'accent',
  title,
  description,
  detailLabel,
  detailValue,
  icon,
  primaryLabel,
  secondaryLabel,
  cancelLabel,
  onPrimary,
  onSecondary,
  onCancel,
  submitting = false,
  detailContent,
  maxWidthClassName,
}) => {
  const { t } = useTranslation()
  const resolvedCancelLabel = cancelLabel ?? t('common.cancel')
  const isDanger = tone === 'danger'
  const iconChipClass = isDanger
    ? 'bg-[rgb(248_113_113/0.14)] text-[var(--status-error)]'
    : 'bg-[rgb(var(--accent-rgb)/0.14)] text-[var(--accent)]'

  return (
    <HyperionModal
      onClose={onCancel}
      zIndexClassName="z-[200]"
      surfaceClassName={`max-h-[min(92vh,760px)] overflow-y-auto hyperion-scrollbar ${maxWidthClassName ?? 'max-w-md'}`}
    >
      <div className="p-6 sm:p-7">
        <div className="mb-4 flex items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconChipClass}`}>
            <Icon name={icon} className="text-[20px]" />
          </span>
          <h2 className="text-[1.05rem] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">{title}</h2>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-[var(--text-support)]">{description}</p>

        {(detailContent || (detailLabel && detailValue)) && (
          <div className="mb-6 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            {detailContent ?? (
              <div className="px-4 py-3">
                <div className="font-mono text-xs text-[var(--text-support)]">{detailLabel}</div>
                <div
                  className="mt-1.5 break-words text-sm font-semibold tracking-[0.01em] text-[var(--text-primary)]"
                  title={detailValue}
                >
                  {detailValue}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          <Button
            variant={isDanger ? 'danger' : 'primary'}
            onPress={onPrimary}
            isDisabled={submitting}
            className="w-full"
          >
            {primaryLabel}
          </Button>
          {secondaryLabel && onSecondary && (
            <Button variant="secondary" onPress={onSecondary} isDisabled={submitting} className="w-full">
              {secondaryLabel}
            </Button>
          )}
          <Button variant="ghost" onPress={onCancel} isDisabled={submitting} className="w-full">
            {resolvedCancelLabel}
          </Button>
        </div>
      </div>
    </HyperionModal>
  )
}
