import React from 'react'
import type { ModMetadata } from '@shared/types'
import { HyperionButton, HyperionIconButton } from '../ui/HyperionPrimitives'

interface LibraryBulkSelectionBarProps {
  selectedModCount: number
  canMove: boolean
  separators: ModMetadata[]
  moveMenuOpen: boolean
  moveMenuRef: React.Ref<HTMLDivElement>
  onToggleMoveMenu: () => void
  onEnableSelected: () => void | Promise<void>
  onDisableSelected: () => void | Promise<void>
  onMoveToSeparator: (separatorId: string) => void | Promise<void>
  onMoveToTopLevel: () => void | Promise<void>
  onDeleteSelected: () => void
  onClearSelection: () => void
}

export const LibraryBulkSelectionBar: React.FC<LibraryBulkSelectionBarProps> = ({
  selectedModCount,
  canMove,
  separators,
  moveMenuOpen,
  moveMenuRef,
  onToggleMoveMenu,
  onEnableSelected,
  onDisableSelected,
  onMoveToSeparator,
  onMoveToTopLevel,
  onDeleteSelected,
  onClearSelection,
}) => (
  <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center px-6">
    <div data-bulk-actions="true" className="pointer-events-auto flex items-stretch gap-4 rounded-sm border-[0.5px] border-[#2e2e2e] bg-[#080808] p-2 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
      <HyperionButton
        onClick={() => void onEnableSelected()}
        variant="toolbar"
        size="sm"
        icon="check_circle"
        iconClassName="text-[15px]"
      >
        Enable
      </HyperionButton>
      <HyperionButton
        onClick={() => void onDisableSelected()}
        variant="toolbar"
        size="sm"
        icon="do_not_disturb_on"
        iconClassName="text-[15px]"
      >
        Disable
      </HyperionButton>
      {canMove && (
        <>
          <div ref={moveMenuRef} className="relative">
            <HyperionButton
              onClick={onToggleMoveMenu}
              variant="toolbar"
              size="sm"
              icon="move_item"
              iconClassName="text-[15px]"
            >
              Move to Separator
              <span className="material-symbols-outlined text-[15px]">{moveMenuOpen ? 'expand_less' : 'expand_more'}</span>
            </HyperionButton>
            {moveMenuOpen && (
              <div className="absolute bottom-[calc(100%+8px)] left-0 min-w-[260px] overflow-hidden rounded-sm border-[0.5px] border-[#2a2a2a] bg-[#0a0a0a] shadow-[0_16px_32px_rgba(0,0,0,0.55)]">
                <div className="border-b-[0.5px] border-[#1a1a1a] px-4 py-2 text-[11px] brand-font font-bold uppercase tracking-[0.16em] text-[#7f7f7f]">
                  Move {selectedModCount} Selected Mods
                </div>
                <div className="max-h-[240px] overflow-y-auto py-1">
                  {separators.length > 0 ? separators.map((separator) => (
                    <button
                      key={separator.uuid}
                      onClick={() => void onMoveToSeparator(separator.uuid)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[11px] brand-font font-bold uppercase tracking-[0.14em] text-[#d8d8d8] transition-colors hover:bg-[#101010] hover:text-[#fcee09]"
                    >
                      <span className="truncate">{separator.name}</span>
                      <span className="material-symbols-outlined text-[15px] text-[#6d6d6d]">subdirectory_arrow_right</span>
                    </button>
                  )) : (
                    <div className="px-4 py-3 text-sm text-[#8a8a8a]">
                      No separators available yet.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <HyperionButton
            onClick={() => void onMoveToTopLevel()}
            variant="toolbar"
            size="sm"
            icon="vertical_align_top"
            iconClassName="text-[15px]"
          >
            Top Level
          </HyperionButton>
        </>
      )}
      <HyperionButton
        onClick={onDeleteSelected}
        variant="danger"
        size="sm"
        icon="delete"
        iconClassName="text-[15px]"
      >
        Uninstall
      </HyperionButton>
      <div className="mx-1.5 h-5 self-center w-px bg-[#2a2a2a] shadow-[0_0_6px_rgba(255,255,255,0.06)]" />
      <HyperionIconButton
        icon="close"
        label="Clear selection"
        variant="ghost"
        iconClassName="text-[15px]"
        onClick={onClearSelection}
      />
    </div>
  </div>
)
