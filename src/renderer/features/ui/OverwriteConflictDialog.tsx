import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { ActionPromptDialog } from './ActionPromptDialog'
import { getArchiveConflictHash, isUnresolvedArchiveConflict } from '../../utils/archiveConflictDisplay'
import { useTranslation } from '../../i18n/I18nContext'

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>()
  const next: T[] = []

  for (const item of items) {
    const key = getKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }

  return next
}

export const OverwriteConflictDialog: React.FC = () => {
  const { t, tn } = useTranslation()
  const {
    overwriteConflictPrompt,
    confirmOverwriteConflicts,
    clearOverwriteConflictPrompt,
  } = useAppStore((state) => ({
    overwriteConflictPrompt: state.overwriteConflictPrompt,
    confirmOverwriteConflicts: state.confirmOverwriteConflicts,
    clearOverwriteConflictPrompt: state.clearOverwriteConflictPrompt,
  }))

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!overwriteConflictPrompt) {
      setSubmitting(false)
    }
  }, [overwriteConflictPrompt])

  const overwriteConflicts = useMemo(
    () => overwriteConflictPrompt?.conflicts.filter((conflict) => conflict.kind === 'overwrite') ?? [],
    [overwriteConflictPrompt]
  )
  const archiveConflicts = useMemo(
    () => overwriteConflictPrompt?.conflicts.filter((conflict) => conflict.kind === 'archive-resource') ?? [],
    [overwriteConflictPrompt]
  )

  if (!overwriteConflictPrompt) return null

  const winningOverwrites = uniqueBy(
    overwriteConflicts.filter((conflict) => conflict.incomingWins),
    (conflict) => `${conflict.existingModId}:${conflict.resourcePath}`
  )
  const losingOverwrites = uniqueBy(
    overwriteConflicts.filter((conflict) => conflict.incomingWins === false),
    (conflict) => `${conflict.existingModId}:${conflict.resourcePath}`
  )
  const affectedMods = new Set(overwriteConflictPrompt.conflicts.map((conflict) => conflict.existingModId)).size
  const previewRows = uniqueBy(overwriteConflictPrompt.conflicts, (conflict) => `${conflict.kind}:${conflict.existingModId}:${conflict.resourcePath}`).slice(0, 14)
  const hiddenCount = Math.max(0, overwriteConflictPrompt.conflicts.length - previewRows.length)
  const incomingOrder = overwriteConflictPrompt.mod.order + 1

  const description = overwriteConflicts.length > 0
    ? losingOverwrites.length > 0
      ? t('dialogs.overwrite.descriptionLosing')
      : t('dialogs.overwrite.descriptionWinning')
    : t('dialogs.overwrite.descriptionArchive')

  const detailContent = (
    <div className="px-4 py-4 sm:px-5 sm:py-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
          <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">{t('dialogs.overwrite.incomingPriority')}</div>
          <div className="mt-2 text-lg font-semibold text-white">#{incomingOrder}</div>
        </div>
        <div className="border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
          <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">{t('dialogs.overwrite.wins')}</div>
          <div className="mt-2 text-lg font-semibold text-[#34d399]">{winningOverwrites.length}</div>
        </div>
        <div className="border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
          <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">{t('dialogs.overwrite.stillOverridden')}</div>
          <div className="mt-2 text-lg font-semibold text-[#fcee09]">{losingOverwrites.length}</div>
        </div>
        <div className="border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
          <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">{t('dialogs.overwrite.affectedMods')}</div>
          <div className="mt-2 text-lg font-semibold text-white">{affectedMods}</div>
        </div>
      </div>

      {archiveConflicts.length > 0 ? (
        <div className="mt-4 border-[0.5px] border-[#4f2020] bg-[#120808] px-4 py-3 text-sm leading-relaxed text-[#f3b8b8]">
          {tn('dialogs.overwrite.archiveConflictNote', archiveConflicts.length)}
        </div>
      ) : null}

      {losingOverwrites.length > 0 ? (
        <div className="mt-4 border-[0.5px] border-[#5a4e12] bg-[#0f0d03] px-4 py-3 text-sm leading-relaxed text-[#efe3a4]">
          {t('dialogs.overwrite.priorityNote')}
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-sm border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a]">
        <div className="grid grid-cols-[124px_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 border-b-[0.5px] border-[#171717] px-4 py-3 text-[11px] brand-font font-bold uppercase tracking-[0.16em] text-[#8d8d8d]">
          <div>{t('dialogs.overwrite.outcome')}</div>
          <div>{t('dialogs.overwrite.gameTarget')}</div>
          <div>{t('dialogs.overwrite.existingMod')}</div>
        </div>
        <div className="max-h-[360px] overflow-y-auto hyperion-scrollbar">
          {previewRows.map((conflict, index) => {
            const archiveHash = getArchiveConflictHash(conflict)
            const showArchiveHash = Boolean(archiveHash && archiveHash !== conflict.resourcePath)
            const tone = conflict.kind === 'archive-resource'
              ? 'border-[#4f2020] bg-[#120808] text-[#f3b8b8]'
              : conflict.incomingWins
                ? 'border-[#1d3d2e] bg-[#091410] text-[#34d399]'
                : 'border-[#5a4e12] bg-[#0f0d03] text-[#fcee09]'
            const label = conflict.kind === 'archive-resource'
              ? t('dialogs.overwrite.tagArchive')
              : conflict.incomingWins
                ? t('dialogs.overwrite.tagIncomingWins')
                : t('dialogs.overwrite.tagExistingWins')

            return (
              <div
                key={`${conflict.kind}:${conflict.existingModId}:${conflict.resourcePath}:${index}`}
                className="grid grid-cols-[124px_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 border-b-[0.5px] border-[#141414] px-4 py-3 last:border-b-0"
              >
                <div>
                  <span className={`inline-flex rounded-sm border-[0.5px] px-2 py-1 text-[10px] brand-font font-bold uppercase tracking-[0.16em] ${tone}`}>
                    {label}
                  </span>
                </div>
                <div className="min-w-0 text-sm text-[#f1eeea]">
                  <div className="break-all">{conflict.resourcePath}</div>
                  {showArchiveHash ? (
                    <div className="mt-1 break-all text-xs text-[#8d8d8d]">
                      {t('dialogs.overwrite.archiveResource', { hash: archiveHash ?? '' })}
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 text-sm text-[#c9c5c2]">
                  <div className="truncate text-[#f1eeea]">{conflict.existingModName}</div>
                  {typeof conflict.existingOrder === 'number' ? (
                    <div className="mt-1 text-xs text-[#8d8d8d]">#{conflict.existingOrder + 1}</div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {hiddenCount > 0 ? (
        <div className="mt-3 text-sm text-[#8d8d8d]">
          {tn('dialogs.overwrite.moreOverlaps', hiddenCount)}
        </div>
      ) : null}
    </div>
  )

  const handleCancel = () => {
    if (submitting) return
    clearOverwriteConflictPrompt()
  }

  const handleProceed = async () => {
    setSubmitting(true)
    try {
      await confirmOverwriteConflicts(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ActionPromptDialog
      accentColor="#fcee09"
      accentGlow="rgba(252,238,9,0.36)"
      title={t('dialogs.overwrite.title')}
      description={description}
      icon="layers"
      primaryLabel={t('dialogs.overwrite.primary')}
      cancelLabel={t('dialogs.overwrite.cancel')}
      onPrimary={() => void handleProceed()}
      onCancel={handleCancel}
      submitting={submitting}
      detailContent={detailContent}
      maxWidthClassName="max-w-4xl"
    />
  )
}

export default OverwriteConflictDialog
