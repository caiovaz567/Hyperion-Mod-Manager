import React, { useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ModMetadata } from '@shared/types'

export type LibraryContextMenuState =
  | {
      kind: 'row'
      mod: ModMetadata
      x: number
      y: number
    }
  | {
      kind: 'list'
      x: number
      y: number
      insertIndex: number
    }

type MenuAction = () => void | Promise<void>
type MenuButtonTone = 'default' | 'subtle' | 'blue' | 'danger' | 'disable'

const menuButtonClassByTone: Record<MenuButtonTone, string> = {
  default: 'text-[#e5e2e1] hover:bg-[#111] hover:text-[#fcee09]',
  subtle: 'text-[#9d9d9d] hover:bg-[#111] hover:text-white',
  blue: 'text-[#c6f4ff] hover:bg-[#08141a] hover:text-[#4fd8ff]',
  danger: 'text-[#ffb4ab] hover:bg-[#93000a]/10',
  disable: 'text-[#e5e2e1] hover:bg-[#111] hover:text-[#ff4d4f]',
}

const MenuDivider: React.FC = () => <div className="my-1 border-t-[0.5px] border-[#222]" />

const MenuButton: React.FC<{
  icon: string
  children: React.ReactNode
  onClick: MenuAction
  tone?: MenuButtonTone
}> = ({ icon, children, onClick, tone = 'default' }) => (
  <button
    onClick={() => void onClick()}
    className={`flex items-center w-full px-4 py-2 text-[11px] transition-colors gap-3 tracking-wider font-semibold uppercase ${menuButtonClassByTone[tone]}`}
  >
    <span className="material-symbols-outlined text-[16px]">{icon}</span>
    <span>{children}</span>
  </button>
)

interface LibraryContextMenuProps {
  menu: LibraryContextMenuState
  menuRef: React.RefObject<HTMLDivElement>
  selectedModCount: number
  hasSeparators: boolean
  hasCollapsedSeparators: boolean
  canMoveSelectedToTopLevel: boolean
  canMoveContextToTopLevel: boolean
  contextTargetCount: number
  onRefreshLibrary: MenuAction
  onCreateSeparatorHere: MenuAction
  onCreateSeparatorAtEnd: MenuAction
  onMoveSelectedToTopLevel: MenuAction
  onToggleAllSeparators: MenuAction
  onCreateSeparatorBeforeRow: MenuAction
  onRename: MenuAction
  onMoveSelectedHere: MenuAction
  onOpenFolder: MenuAction
  onDelete: MenuAction
  onReinstall: MenuAction
  onDetails: MenuAction
  onMoveContextToTopLevel: MenuAction
  onEnable: MenuAction
  onDisable: MenuAction
  onOpenOnNexus: MenuAction
}

export const LibraryContextMenu: React.FC<LibraryContextMenuProps> = ({
  menu,
  menuRef,
  selectedModCount,
  hasSeparators,
  hasCollapsedSeparators,
  canMoveSelectedToTopLevel,
  canMoveContextToTopLevel,
  contextTargetCount,
  onRefreshLibrary,
  onCreateSeparatorHere,
  onCreateSeparatorAtEnd,
  onMoveSelectedToTopLevel,
  onToggleAllSeparators,
  onCreateSeparatorBeforeRow,
  onRename,
  onMoveSelectedHere,
  onOpenFolder,
  onDelete,
  onReinstall,
  onDetails,
  onMoveContextToTopLevel,
  onEnable,
  onDisable,
  onOpenOnNexus,
}) => {
  useLayoutEffect(() => {
    if (!menuRef.current) return

    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = menu.x
    let y = menu.y

    if (x + rect.width > vw - 8) x = vw - rect.width - 8
    if (y + rect.height > vh - 8) y = vh - rect.height - 8
    if (x < 8) x = 8
    if (y < 8) y = 8

    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }, [menu, menuRef])

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[100] bg-[#0a0a0a] border-[0.5px] border-[#222] shadow-[0_10px_30px_rgba(0,0,0,0.5)] py-1 min-w-[220px] brand-font"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <MenuButton icon="refresh" onClick={onRefreshLibrary}>
        Refresh Library
      </MenuButton>
      <MenuDivider />

      {menu.kind === 'list' ? (
        <>
          <MenuButton icon="label" onClick={onCreateSeparatorHere}>
            Create Separator Here
          </MenuButton>
          <MenuButton icon="south" onClick={onCreateSeparatorAtEnd} tone="subtle">
            Create Separator at End
          </MenuButton>
          {((selectedModCount > 0 && canMoveSelectedToTopLevel) || hasSeparators) && <MenuDivider />}
          {selectedModCount > 0 && canMoveSelectedToTopLevel && (
            <MenuButton icon="vertical_align_top" onClick={onMoveSelectedToTopLevel} tone="blue">
              Move Selected to Top Level
            </MenuButton>
          )}
          {hasSeparators && (
            <MenuButton
              icon={hasCollapsedSeparators ? 'unfold_more' : 'unfold_less'}
              onClick={onToggleAllSeparators}
            >
              {hasCollapsedSeparators ? 'Expand All Separators' : 'Collapse All Separators'}
            </MenuButton>
          )}
        </>
      ) : menu.mod.kind === 'separator' ? (
        <>
          <MenuButton icon="segment" onClick={onCreateSeparatorBeforeRow}>
            Create Separator Before
          </MenuButton>
          {hasSeparators && (
            <MenuButton
              icon={hasCollapsedSeparators ? 'unfold_more' : 'unfold_less'}
              onClick={onToggleAllSeparators}
            >
              {hasCollapsedSeparators ? 'Expand All Separators' : 'Collapse All Separators'}
            </MenuButton>
          )}
          <MenuDivider />
          <MenuButton icon="edit" onClick={onRename}>
            Rename Separator
          </MenuButton>
          {selectedModCount > 0 && canMoveSelectedToTopLevel && (
            <MenuButton icon="move_down" onClick={onMoveSelectedHere} tone="blue">
              Move {selectedModCount} Selected Here
            </MenuButton>
          )}
          <MenuDivider />
          <MenuButton icon="folder_open" onClick={onOpenFolder}>
            Open in File Explorer
          </MenuButton>
          <MenuButton icon="delete" onClick={onDelete} tone="danger">
            Delete Separator
          </MenuButton>
        </>
      ) : (
        <>
          <MenuButton icon="segment" onClick={onCreateSeparatorBeforeRow}>
            Create Separator Before
          </MenuButton>
          <MenuButton icon="settings_backup_restore" onClick={onReinstall}>
            Reinstall
          </MenuButton>
          <MenuDivider />
          <MenuButton icon="info" onClick={onDetails}>
            Details
          </MenuButton>
          <MenuButton icon="edit" onClick={onRename}>
            Rename
          </MenuButton>
          {canMoveContextToTopLevel && (
            <MenuButton icon="vertical_align_top" onClick={onMoveContextToTopLevel} tone="blue">
              {contextTargetCount > 1 ? 'Move Selected to Top Level' : 'Move to Top Level'}
            </MenuButton>
          )}
          <MenuDivider />
          <MenuButton icon="toggle_on" onClick={onEnable}>
            Enable
          </MenuButton>
          <MenuButton icon="toggle_off" onClick={onDisable} tone="disable">
            Disable
          </MenuButton>
          <MenuDivider />
          {(menu.mod.nexusModId || menu.mod.nexusFileId) && (
            <MenuButton icon="open_in_new" onClick={onOpenOnNexus}>
              Open on Nexus
            </MenuButton>
          )}
          <MenuButton icon="folder_open" onClick={onOpenFolder}>
            Open in File Explorer
          </MenuButton>
          <MenuDivider />
          <MenuButton icon="delete" onClick={onDelete} tone="danger">
            Delete
          </MenuButton>
        </>
      )}
    </div>,
    document.body
  )
}
