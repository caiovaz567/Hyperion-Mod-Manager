import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { ActionPromptDialog } from './ActionPromptDialog'

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
      ? 'This install shares game-target paths with enabled mods. Hyperion will respect library order, so files from mods below this position still win over the incoming mod.'
      : 'This install shares game-target paths with enabled mods. Hyperion will deploy it using library order, so the incoming mod will take priority where it lands later in the stack.'
    : 'This install also touches archive resources already present in enabled mods. Review the overlap before continuing.'

  const detailContent = (
    <div className="px-4 py-4 sm:px-5 sm:py-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
          <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">Incoming Priority</div>
          <div className="mt-2 text-lg font-semibold text-white">#{incomingOrder}</div>
        </div>
        <div className="border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
          <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">Wins</div>
          <div className="mt-2 text-lg font-semibold text-[#34d399]">{winningOverwrites.length}</div>
        </div>
        <div className="border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
          <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">Still Overridden</div>
          <div className="mt-2 text-lg font-semibold text-[#fcee09]">{losingOverwrites.length}</div>
        </div>
        <div className="border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
          <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">Affected Mods</div>
          <div className="mt-2 text-lg font-semibold text-white">{affectedMods}</div>
        </div>
      </div>

      {archiveConflicts.length > 0 ? (
        <div className="mt-4 border-[0.5px] border-[#4f2020] bg-[#120808] px-4 py-3 text-sm leading-relaxed text-[#f3b8b8]">
          {archiveConflicts.length} archive resource conflict{archiveConflicts.length === 1 ? '' : 's'} detected. These are not simple file overwrites and may still depend on archive load behavior.
        </div>
      ) : null}

      {losingOverwrites.length > 0 ? (
        <div className="mt-4 border-[0.5px] border-[#5a4e12] bg-[#0f0d03] px-4 py-3 text-sm leading-relaxed text-[#efe3a4]">
          Mods with a higher `#` position than this install will keep priority on those shared paths.
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-sm border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a]">
        <div className="grid grid-cols-[124px_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 border-b-[0.5px] border-[#171717] px-4 py-3 text-[11px] brand-font font-bold uppercase tracking-[0.16em] text-[#8d8d8d]">
          <div>Outcome</div>
          <div>Game Target</div>
          <div>Existing Mod</div>
        </div>
        <div className="max-h-[360px] overflow-y-auto hyperion-scrollbar">
          {previewRows.map((conflict, index) => {
            const tone = conflict.kind === 'archive-resource'
              ? 'border-[#4f2020] bg-[#120808] text-[#f3b8b8]'
              : conflict.incomingWins
                ? 'border-[#1d3d2e] bg-[#091410] text-[#34d399]'
                : 'border-[#5a4e12] bg-[#0f0d03] text-[#fcee09]'
            const label = conflict.kind === 'archive-resource'
              ? 'Archive'
              : conflict.incomingWins
                ? 'Incoming Wins'
                : 'Existing Wins'

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
                <div className="min-w-0 break-all text-sm text-[#f1eeea]">{conflict.resourcePath}</div>
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
          +{hiddenCount} more overlap{hiddenCount === 1 ? '' : 's'} in this install.
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
      title="Overwrite Preview"
      description={description}
      icon="layers"
      primaryLabel="Install With Current Priority"
      cancelLabel="Cancel Install"
      onPrimary={() => void handleProceed()}
      onCancel={handleCancel}
      submitting={submitting}
      detailContent={detailContent}
      maxWidthClassName="max-w-4xl"
    />
  )
}

export default OverwriteConflictDialog