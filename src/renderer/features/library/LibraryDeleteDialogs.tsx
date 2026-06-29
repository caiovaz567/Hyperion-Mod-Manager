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

const DELETE_ACCENT = '#ff4d4f'
const DELETE_GLOW = 'rgba(255,77,79,0.4)'

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
        accentColor={DELETE_ACCENT}
        accentGlow="rgba(255,77,79,0.45)"
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
        primaryTextColor="#ffffff"
      />
    )}

    {pendingAction?.type === 'delete-all' && (
      <ActionPromptDialog
        accentColor={DELETE_ACCENT}
        accentGlow={DELETE_GLOW}
        title={t('library.delete.allTitle')}
        description={t('library.delete.allDescription')}
        detailLabel={hasSeparators ? t('library.delete.allDetailLabelEntries') : t('library.delete.allDetailLabelInstalled')}
        detailValue={String(pendingAction.count)}
        icon="delete_sweep"
        primaryLabel={t('library.delete.everything')}
        primaryTextColor="#ffffff"
        onPrimary={() => void onConfirmDeleteAll()}
        onCancel={onCancelAction}
        submitting={submitting}
      />
    )}

    {pendingAction?.type === 'delete-selected' && (
      <ActionPromptDialog
        accentColor={DELETE_ACCENT}
        accentGlow={DELETE_GLOW}
        title={t('library.delete.selectedTitle')}
        description={t('library.delete.selectedDescription')}
        detailLabel={t('library.delete.selectedDetailLabel')}
        detailValue={String(pendingAction.count)}
        detailContent={(
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#1d1d1d] pb-3">
              <div className="text-sm font-mono text-[#9a9a9a]">
                {t('library.delete.modsBeingUninstalled')}
              </div>
              <div className="rounded-sm border-[0.5px] border-[#4a1c1c] bg-[#160909] px-2.5 py-1 text-sm font-mono text-[#ffb4ab]">
                {t('library.delete.selectedCount', { count: pendingAction.count })}
              </div>
            </div>
            <div className="delete-dialog-scrollbar mt-3 max-h-[248px] space-y-2 overflow-y-auto pr-1">
              {selectedMods.map((mod) => (
                <div
                  key={mod.uuid}
                  className="rounded-sm border-[0.5px] border-[#2c1515] bg-[#120909] px-3 py-2 text-[12px] text-[#ffe1e1] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
                >
                  {mod.name}
                </div>
              ))}
            </div>
          </div>
        )}
        icon="delete"
        primaryLabel={t('library.delete.deleteSelected')}
        primaryTextColor="#ffffff"
        onPrimary={() => void onConfirmDeleteSelected(pendingAction.modIds)}
        onCancel={onCancelAction}
        submitting={submitting}
      />
    )}
  </>
  )
}
