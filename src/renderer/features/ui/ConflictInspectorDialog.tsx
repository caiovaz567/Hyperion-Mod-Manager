import React, { useMemo } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { ActionPromptDialog } from './ActionPromptDialog'
import { getArchiveConflictHash, isUnresolvedArchiveConflict } from '../../utils/archiveConflictDisplay'

export const ConflictInspectorDialog: React.FC = () => {
  const { dialogs, closeDialog, selectedModId, mods, conflicts } = useAppStore((state) => ({
    dialogs: state.dialogs,
    closeDialog: state.closeDialog,
    selectedModId: state.selectedModId,
    mods: state.mods,
    conflicts: state.conflicts,
  }), shallow)

  if (!dialogs.conflictInspector || !selectedModId) return null

  const mod = mods.find((m) => m.uuid === selectedModId)
  if (!mod) return null

  const wins = useMemo(
    () => conflicts.filter((c) => c.incomingModId === mod.uuid || (c.incomingModName === mod.name && typeof c.incomingOrder === 'number' && c.incomingOrder === mod.order)),
    [conflicts, mod]
  )

  const losses = useMemo(() => conflicts.filter((c) => c.existingModId === mod.uuid), [conflicts, mod])

  const detailContent = (
    <div className="px-4 py-4 sm:px-5 sm:py-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
          <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">Mod</div>
          <div className="mt-2 text-lg font-semibold text-white">{mod.name}</div>
        </div>
        <div className="border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
          <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">Overwrites</div>
          <div className="mt-2 text-lg font-semibold text-[#34d399]">{wins.length}</div>
        </div>
        <div className="border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
          <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">Overridden By</div>
          <div className="mt-2 text-lg font-semibold text-[#fcee09]">{losses.length}</div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-sm border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a]">
        <div className="grid grid-cols-[124px_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 border-b-[0.5px] border-[#171717] px-4 py-3 text-[11px] brand-font font-bold uppercase tracking-[0.16em] text-[#8d8d8d]">
          <div>Outcome</div>
          <div>Game Target</div>
          <div>Other Mod</div>
        </div>
        <div className="max-h-[360px] overflow-y-auto hyperion-scrollbar">
          {wins.concat(losses).map((conflict, index) => {
            const isWin = conflict.incomingModId === mod.uuid || (conflict.incomingModName === mod.name && conflict.incomingOrder === mod.order)
            const archiveHash = getArchiveConflictHash(conflict)
            const showArchiveHash = Boolean(archiveHash && archiveHash !== conflict.resourcePath)
            const unresolvedArchiveConflict = isUnresolvedArchiveConflict(conflict)
            const tone = conflict.kind === 'archive-resource'
              ? 'border-[#4f2020] bg-[#120808] text-[#f3b8b8]'
              : isWin
                ? 'border-[#1d3d2e] bg-[#091410] text-[#34d399]'
                : 'border-[#5a4e12] bg-[#0f0d03] text-[#fcee09]'
            const label = conflict.kind === 'archive-resource'
              ? 'Archive'
              : isWin
                ? 'This Mod Wins'
                : 'Other Wins'

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
                  {showArchiveHash || unresolvedArchiveConflict ? (
                    <div className="mt-1 break-all text-xs text-[#8d8d8d]">
                      {unresolvedArchiveConflict ? 'Unresolved archive hash' : 'Archive hash'}: {archiveHash}
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 text-sm text-[#c9c5c2]">
                  <div className="truncate text-[#f1eeea]">{isWin ? conflict.existingModName : conflict.incomingModName}</div>
                  {typeof conflict.existingOrder === 'number' ? (
                    <div className="mt-1 text-xs text-[#8d8d8d]">#{(conflict.existingOrder ?? 0) + 1}</div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <ActionPromptDialog
      accentColor="#fcee09"
      accentGlow="rgba(252,238,9,0.36)"
      title="Conflict Inspector"
      description={`Conflict summary for ${mod.name}`}
      icon="report_problem"
      primaryLabel="Close"
      cancelLabel="Close"
      onPrimary={() => closeDialog('conflictInspector')}
      onCancel={() => closeDialog('conflictInspector')}
      submitting={false}
      detailContent={detailContent}
      maxWidthClassName="max-w-3xl"
    />
  )
}

export default ConflictInspectorDialog
