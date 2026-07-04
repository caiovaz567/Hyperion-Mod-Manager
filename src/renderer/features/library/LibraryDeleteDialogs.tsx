import React from 'react'
import type { ModMetadata } from '@shared/types'
import { ActionPromptDialog } from '../ui/ActionPromptDialog'
import { useTranslation } from '../../i18n/I18nContext'

export type LibraryPendingActionState =
  | { type: 'delete-all'; count: number }
  | { type: 'delete-selected'; count: number; modIds: string[] }

interface LibraryDeleteDialogsProps {
  pendingDeleteMod: ModMetadata | null
  pendingAction: LibraryPendingActionState | null
  selectedMods: ModMetadata[]
  submitting: boolean
  hasSeparators: boolean
  onConfirmDeleteMod: (mod: ModMetadata) => void | Promise<void>
  onCancelDeleteMod: () => void
  onConfirmDeleteAll: () => void | Promise<void>
  onConfirmDeleteSelected: (modIds: string[]) => void | Promise<void>
  onCancelAction: () => void
}

export const LibraryDeleteDialogs: React.FC<LibraryDeleteDialogsProps> = ({
  pendingDeleteMod,
  pendingAction,
  selectedMods,
  submitting,
  hasSeparators,
  onConfirmDeleteMod,
  onCancelDeleteMod,
  onConfirmDeleteAll,
  onConfirmDeleteSelected,
  onCancelAction,
}) => {
  const { t } = useTranslation()
  return (
  <>
    {pendingDeleteMod && (
      <ActionPromptDialog
        tone="danger"
        title={pendingDeleteMod.kind === 'separator' ? t('library.delete.separatorTitle') : t('library.delete.modTitle')}
        description={pendingDeleteMod.kind === 'separator'
          ? t('library.delete.separatorDescription', { name: pendingDeleteMod.name })
          : t('library.delete.modDescription', { name: pendingDeleteMod.name })}
        detailLabel={pendingDeleteMod.kind === 'separator' ? t('library.delete.separatorDetailLabel') : t('library.delete.modDetailLabel')}
        detailValue={pendingDeleteMod.name}
        icon="delete"
        primaryLabel={t('common.delete')}
        onPrimary={() => void onConfirmDeleteMod(pendingDeleteMod)}
        onCancel={onCancelDeleteMod}
      />
    )}

    {pendingAction?.type === 'delete-all' && (
      <ActionPromptDialog
        tone="danger"
        title={t('library.delete.allTitle')}
        description={t('library.delete.allDescription')}
        detailLabel={hasSeparators ? t('library.delete.allDetailLabelEntries') : t('library.delete.allDetailLabelInstalled')}
        detailValue={String(pendingAction.count)}
        icon="delete_sweep"
        primaryLabel={t('library.delete.everything')}
        onPrimary={() => void onConfirmDeleteAll()}
        onCancel={onCancelAction}
        submitting={submitting}
      />
    )}

    {pendingAction?.type === 'delete-selected' && (
      <ActionPromptDialog
        tone="danger"
        title={t('library.delete.selectedTitle')}
        description={t('library.delete.selectedDescription')}
        detailLabel={t('library.delete.selectedDetailLabel')}
        detailValue={String(pendingAction.count)}
        detailContent={(
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
              <div className="text-[15px] text-[var(--text-support)]">
                {t('library.delete.modsBeingUninstalled')}
              </div>
              <div className="rounded-lg bg-[rgb(248_113_113/0.12)] px-2.5 py-1 text-[15px] font-semibold text-[var(--status-error)]">
                {t('library.delete.selectedCount', { count: pendingAction.count })}
              </div>
            </div>
            <div className="delete-dialog-scrollbar mt-3 max-h-[248px] space-y-1.5 overflow-y-auto pr-1">
              {selectedMods.map((mod) => (
                <div
                  key={mod.uuid}
                  className="rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-[13px] text-[var(--text-secondary)]"
                >
                  {mod.name}
                </div>
              ))}
            </div>
          </div>
        )}
        icon="delete"
        primaryLabel={t('library.delete.deleteSelected')}
        onPrimary={() => void onConfirmDeleteSelected(pendingAction.modIds)}
        onCancel={onCancelAction}
        submitting={submitting}
      />
    )}
  </>
  )
}
