import React, { useEffect, useMemo, useState } from 'react'
import type { ModMetadata } from '@shared/types'
import { IPC } from '@shared/types'
import { IpcService } from '../../services/IpcService'
import { useAppStore } from '../../store/useAppStore'
import { Tooltip } from '../ui/Tooltip'
import { formatWindowsDateTimeOrFallback } from '../../utils/dateFormat'

interface DetailPanelProps {
  modId: string
  onClose: () => void
  onDeleteRequest: (mod: ModMetadata) => void
  initialEditName?: boolean
}

const TYPE_COLOR: Record<string, string> = {
  archive: '#60A5FA',
  redmod: '#34D399',
  cet: '#40dbdb',
  redscript: '#A78BFA',
  tweakxl: '#fbbf24',
  red4ext: '#F87171',
  bin: '#94A3B8',
  engine: '#C084FC',
  r6: '#60A5FA',
  unknown: '#64748B',
}

const formatSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return 'Unknown'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const DetailItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="border-[0.5px] border-[#1a1a1a] bg-[#090909] px-4 py-3">
    <div className="ui-support-mono mb-2 uppercase tracking-[0.2em] text-[#9a9a9a] brand-font font-bold">{label}</div>
    <div className="break-words text-sm font-mono text-[#e5e2e1]">{value}</div>
  </div>
)

export const DetailPanel: React.FC<DetailPanelProps> = ({
  modId,
  onClose,
  onDeleteRequest,
  initialEditName = false,
}) => {
  const { mods, updateModMetadata, addToast, settings } = useAppStore()
  const mod = mods.find((item) => item.uuid === modId)
  const [editingName, setEditingName] = useState(initialEditName)
  const [nameValue, setNameValue] = useState(mod?.name ?? '')

  useEffect(() => {
    setEditingName(initialEditName)
  }, [initialEditName, modId])

  useEffect(() => {
    setNameValue(mod?.name ?? '')
  }, [mod?.name, modId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const visibleFiles = useMemo(() => mod?.files.filter((file) => file !== '_metadata.json') ?? [], [mod?.files])

  if (!mod) return null

  const typeColor = TYPE_COLOR[mod.type] ?? '#64748B'

  const handleSaveName = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed) {
      addToast('Mod name cannot be empty', 'warning')
      return
    }

    await updateModMetadata(mod.uuid, { name: trimmed })
    addToast('Mod name updated', 'success', 1800)
    setEditingName(false)
  }

  const handleOpenFolder = async () => {
    if (!settings?.libraryPath) return
    const modPath = `${settings.libraryPath}\\${mod.folderName ?? mod.uuid}`
    await IpcService.invoke(IPC.OPEN_PATH, modPath)
  }

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/75 backdrop-blur-[2px] px-6 animate-settings-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl overflow-hidden border-[0.5px] border-[#222] bg-[#050505] shadow-[0_20px_60px_rgba(0,0,0,0.7)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="absolute left-0 top-0 h-[2px] w-full"
          style={{ background: typeColor, boxShadow: `0 0 14px ${typeColor}55` }}
        />

        <div className="flex items-start justify-between gap-6 border-b-[0.5px] border-[#1a1a1a] bg-[#070707] px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="ui-support-mono mb-2 uppercase tracking-[0.22em] text-[#9a9a9a] brand-font font-bold">Mod Details</div>
            {editingName ? (
              <div className="flex items-center gap-3">
                <input
                  autoFocus
                  value={nameValue}
                  onChange={(event) => setNameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleSaveName()
                    if (event.key === 'Escape') {
                      setNameValue(mod.name)
                      setEditingName(false)
                    }
                  }}
                  className="w-full max-w-xl border-[0.5px] border-[#7a7a7a] bg-[#0a0a0a] px-4 py-2 text-white font-medium tracking-tight focus:border-[#fcee09]/60 focus:shadow-[0_0_10px_rgba(252,238,9,0.12)] focus:outline-none"
                />
                <button
                  onClick={() => void handleSaveName()}
                  className="px-4 py-2 bg-[#fcee09] text-[#050505] text-[10px] brand-font font-bold uppercase tracking-widest hover:bg-white transition-colors"
                >
                  Save
                </button>
              </div>
            ) : (
              <h2 className="truncate brand-font text-2xl font-bold uppercase tracking-[0.04em] text-white">{mod.name}</h2>
            )}
            <p className="ui-support-mono mt-3 uppercase tracking-[0.14em]">
              {mod.folderName ?? mod.uuid} • {visibleFiles.length} files indexed
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Tooltip content="Rename mod">
              <button
                onClick={() => setEditingName((value) => !value)}
                className="flex h-10 w-10 items-center justify-center border-[0.5px] border-[#222] bg-[#0a0a0a] text-[#8a8a8a] hover:border-[#fcee09]/50 hover:text-[#fcee09] hover:shadow-[0_0_10px_rgba(252,238,9,0.1)] transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">edit</span>
              </button>
            </Tooltip>
            <Tooltip content="Open mod folder">
              <button
                onClick={handleOpenFolder}
                className="flex h-10 w-10 items-center justify-center border-[0.5px] border-[#222] bg-[#0a0a0a] text-[#8a8a8a] hover:border-[#fcee09]/50 hover:text-[#fcee09] hover:shadow-[0_0_10px_rgba(252,238,9,0.1)] transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">folder_open</span>
              </button>
            </Tooltip>
            <Tooltip content="Remove mod">
              <button
                onClick={() => onDeleteRequest(mod)}
                className="flex h-10 w-10 items-center justify-center border-[0.5px] border-[#222] bg-[#0a0a0a] text-[#8a8a8a] hover:border-[#ff4d4f]/50 hover:text-[#ff4d4f] hover:shadow-[0_0_10px_rgba(255,77,79,0.12)] transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            </Tooltip>
            <Tooltip content="Close details">
              <button
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center border-[0.5px] border-[#222] bg-[#0a0a0a] text-[#8a8a8a] hover:border-white/20 hover:text-white transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)] gap-6 p-6">
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <DetailItem label="Installation Time" value={formatWindowsDateTimeOrFallback(mod.installedAt, 'Not tracked')} />
              <DetailItem label="Enabled Time" value={mod.enabled ? formatWindowsDateTimeOrFallback(mod.enabledAt, 'Not tracked') : 'Disabled'} />
              <DetailItem label="Downloaded Time" value={formatWindowsDateTimeOrFallback(mod.sourceModifiedAt, 'Not tracked')} />
              <DetailItem label="File Size" value={formatSize(mod.fileSize)} />
              <DetailItem label="Type" value={mod.type.toUpperCase()} />
              <DetailItem label="Version" value={mod.version ?? 'Unknown'} />
              <DetailItem label="Mod Name" value={mod.name} />
              <DetailItem label="Source" value={mod.sourceType ? mod.sourceType.toUpperCase() : 'Manual'} />
            </div>

            <div className="border-[0.5px] border-[#1a1a1a] bg-[#070707] p-4">
              <div className="ui-support-mono mb-3 uppercase tracking-[0.2em] text-[#9a9a9a] brand-font font-bold">Source Path</div>
              <div className="ui-support-mono break-all">{mod.sourcePath ?? 'No original source recorded for this mod'}</div>
            </div>
          </div>

          <div className="overflow-hidden border-[0.5px] border-[#1a1a1a] bg-[#070707]">
            <div className="flex items-center justify-between border-b-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3">
              <div className="ui-support-mono uppercase tracking-[0.2em] text-[#9a9a9a] brand-font font-bold">Indexed Files</div>
              <div className="ui-support-mono">{visibleFiles.length}</div>
            </div>
            <div className="max-h-[420px] space-y-2 overflow-y-auto px-4 py-3">
              {visibleFiles.length > 0 ? visibleFiles.map((file) => (
                <div
                  key={file}
                  className="ui-support-mono border-[0.5px] border-[#141414] bg-[#060606] px-3 py-2 hover:border-[#222] hover:text-[#c0c0c0] transition-colors"
                >
                  {file}
                </div>
              )) : (
                <div className="ui-support-mono py-12 text-center uppercase tracking-[0.18em]">
                  No indexed files available
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
