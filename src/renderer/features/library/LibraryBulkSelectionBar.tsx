import React from 'react'
import { HyperionButton, HyperionIconButton } from '../ui/HyperionPrimitives'

interface LibraryBulkSelectionBarProps {
  canMove: boolean
  hasSeparators: boolean
  onOpenMoveMenu: () => void
  onEnableSelected: () => void | Promise<void>
  onDisableSelected: () => void | Promise<void>
  onMoveToTopLevel: () => void | Promise<void>
  onDeleteSelected: () => void
  onClearSelection: () => void
}

export const LibraryBulkSelectionBar: React.FC<LibraryBulkSelectionBarProps> = ({
  canMove,
  hasSeparators,
  onOpenMoveMenu,
  onEnableSelected,
  onDisableSelected,
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
          {hasSeparators && (
            <HyperionButton
              onClick={onOpenMoveMenu}
              variant="toolbar"
              size="sm"
              icon="move_item"
              iconClassName="text-[15px]"
            >
              Move to Separator
            </HyperionButton>
          )}
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
