import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ModMetadata } from '@shared/types'

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
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 40)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return separators
    return separators.filter((separator) => separator.name.toLowerCase().includes(query))
  }, [search, separators])

  return createPortal(
    <div
      data-action-prompt="true"
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
      onClick={(event) => {
        event.stopPropagation()
        onCancel()
      }}
    >
      <div
        className="relative flex max-h-[calc(100vh-96px)] w-full max-w-[680px] flex-col overflow-hidden border-[0.5px] border-[#222] bg-[#050505] shadow-[0_20px_50px_rgba(0,0,0,0.8)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="absolute left-0 top-0 h-[2px] w-full bg-[#fcee09] shadow-[0_0_12px_rgba(252,238,9,0.35)]" />

        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-5">
          <div className="mb-4 flex items-center gap-3 text-[#fcee09]">
            <span className="material-symbols-outlined text-[20px]">move_item</span>
            <h2 className="brand-font text-[1.05rem] font-bold uppercase tracking-[0.08em] text-white">
              Move to Separator
            </h2>
          </div>

          <p className="mb-4 text-sm leading-relaxed text-[#a2a2a2]">
            {modCount === 1
              ? 'Choose a separator to move this mod into.'
              : `Choose a separator to move ${modCount} selected mods into.`}
          </p>

          {/* Search — border lives on the wrapper, never on the input */}
          <div className="mb-3 flex items-center gap-2 border-[0.5px] border-[#2d2d2d] bg-[#0a0a0a] px-3 transition-colors focus-within:border-[#fcee09]/40">
            <span className="material-symbols-outlined text-[16px] text-[#555]">search</span>
            <input
              ref={inputRef}
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search separators..."
              className="h-11 w-full border-0 bg-transparent text-[14px] text-[#e5e2e1] placeholder-[#444] outline-none focus:outline-none focus-visible:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-[#555] transition-colors hover:text-[#999]"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>

          {/* Separator list */}
          <div className="min-h-[340px] flex-1 overflow-y-auto hyperion-scrollbar border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a]">
            {filtered.length > 0 ? (
              filtered.map((separator) => (
                <button
                  key={separator.uuid}
                  onClick={() => onSelect(separator.uuid)}
                  className="group grid h-10 w-full grid-cols-[28px_minmax(0,1fr)_28px] items-center border-b-[0.5px] border-[#141414] px-3 text-center transition-colors last:border-b-0 hover:bg-[rgba(252,238,9,0.08)] focus:outline-none focus-visible:bg-[rgba(252,238,9,0.10)] focus-visible:shadow-[inset_2px_0_0_rgba(252,238,9,0.85)]"
                >
                  <span aria-hidden="true" />
                  <span className="truncate text-center text-[13px] font-semibold text-[#e5e2e1] transition-colors group-hover:text-[#fcee09]">
                    {separator.name}
                  </span>
                  <span className="material-symbols-outlined justify-self-end text-[16px] text-[#555] transition-colors group-hover:text-[#fcee09]">
                    arrow_forward
                  </span>
                </button>
              ))
            ) : (
              <div className="px-4 py-6 text-center text-[13px] italic text-[#555]">
                No separators match your search.
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end">
            <button
              onClick={onCancel}
              className="h-10 rounded-sm border-[0.5px] border-[#2a2a2a] bg-[#0a0a0a] px-4 text-[11px] brand-font font-bold uppercase tracking-[0.16em] text-[#9a9a9a] transition-colors hover:border-[#4c4c4c] hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
