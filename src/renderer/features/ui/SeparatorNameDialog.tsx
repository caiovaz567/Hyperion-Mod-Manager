import React, { useLayoutEffect, useRef } from 'react'
import { Button, Input } from '@heroui/react'
import { HyperionModal, HyperionModalHeader } from './HyperionPrimitives'
import { useTranslation } from '../../i18n/I18nContext'

interface SeparatorNameDialogProps {
  title: string
  description: string
  value: string
  submitLabel: string
  inputLabel?: string
  placeholder?: string
  selectOnOpen?: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  submitting?: boolean
}

export const SeparatorNameDialog: React.FC<SeparatorNameDialogProps> = ({
  title,
  description,
  value,
  submitLabel,
  inputLabel,
  placeholder,
  selectOnOpen = false,
  onChange,
  onSubmit,
  onCancel,
  submitting = false,
}) => {
  const { t } = useTranslation()
  const resolvedInputLabel = inputLabel ?? t('library.separatorDialog.nameLabel')
  const inputRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus({ preventScroll: true })
      if (selectOnOpen) {
        inputRef.current?.select()
      } else {
        const length = inputRef.current?.value.length ?? 0
        inputRef.current?.setSelectionRange(length, length)
      }
    }

    focusInput()
    const rafOne = window.requestAnimationFrame(() => focusInput())
    const rafTwo = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => focusInput())
    })
    const id = window.setTimeout(() => {
      focusInput()
    }, 120)

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape is handled by the shared modal shell; this only owns Enter → submit.
      if (event.key === 'Enter') {
        event.preventDefault()
        onSubmit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(rafOne)
      window.cancelAnimationFrame(rafTwo)
      window.clearTimeout(id)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onSubmit, selectOnOpen])

  return (
    <HyperionModal onClose={onCancel} surfaceClassName="max-w-[520px]">
      <div className="px-6 pb-6 pt-6">
        <HyperionModalHeader icon="label" title={title} className="mb-3" />

        <p className="mb-5 text-sm leading-relaxed text-[var(--text-support)]">
          {description}
        </p>

        <label className="mb-2 block text-[12px] font-medium text-[var(--text-secondary)]">
          {resolvedInputLabel}
        </label>
        <Input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full"
        />

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="tertiary" onPress={onCancel} isDisabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onPress={onSubmit} isDisabled={submitting}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </HyperionModal>
  )
}
