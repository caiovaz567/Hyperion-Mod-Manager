import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import type { ModMetadata } from '@shared/types'
import { HyperionModal, HyperionModalHeader, HyperionSearchField } from './HyperionPrimitives'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from './Icon'

interface MoveToSeparatorDialogProps {
  separators: ModMetadata[]
  modCount: number
  onSelect: (separatorId: string) => void
  onCancel: () => void
}

export const MoveToSeparatorDialog: React.FC<MoveToSeparatorDialogProps> = ({
  separators,
  modCount,
  onSelect,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Escape is handled by the shared modal shell; this only auto-focuses the search field.
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 40)
    return () => window.clearTimeout(timer)
  }, [])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return separators
    return separators.filter((separator) => separator.name.toLowerCase().includes(query))
  }, [search, separators])

  return (
    <HyperionModal onClose={onCancel} surfaceClassName="flex max-h-[calc(100vh-96px)] max-w-[560px] flex-col">
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-6">
        <HyperionModalHeader icon="move_item" title={t('dialogs.moveToSeparator.title')} className="mb-3" />

        <p className="mb-4 text-sm leading-relaxed text-[var(--text-support)]">
          {modCount === 1
            ? t('dialogs.moveToSeparator.descriptionOne')
            : t('dialogs.moveToSeparator.descriptionMany', { count: modCount })}
        </p>

        <HyperionSearchField
          ref={inputRef}
          wrapperClassName="mb-3 min-w-0 max-w-none"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch('')}
          placeholder={t('dialogs.moveToSeparator.searchPlaceholder')}
        />

        {/* Separator list */}
        <div className="min-h-[300px] flex-1 overflow-y-auto hyperion-scrollbar rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
          {filtered.length > 0 ? (
            filtered.map((separator) => (
              <button
                key={separator.uuid}
                onClick={() => onSelect(separator.uuid)}
                className="group grid h-10 w-full grid-cols-[28px_minmax(0,1fr)_28px] items-center rounded-lg px-3 text-center transition-colors hover:bg-[rgb(var(--accent-rgb)/0.10)] focus:outline-none focus-visible:bg-[rgb(var(--accent-rgb)/0.12)]"
              >
                <span aria-hidden="true" />
                <span className="truncate text-center text-[13px] font-semibold text-[var(--text-primary-alt)] transition-colors group-hover:text-[var(--accent)]">
                  {separator.name}
                </span>
                <Icon name="arrow_forward" className="justify-self-end text-[16px] text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]" />
              </button>
            ))
          ) : (
            <div className="px-4 py-6 text-center text-[13px] italic text-[var(--text-muted)]">
              {t('dialogs.moveToSeparator.noMatch')}
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end">
          <Button variant="tertiary" onPress={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </HyperionModal>
  )
}
