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
  labelClassName?: string
}> = ({ icon, children, onClick, tone = 'default', labelClassName = '' }) => (
  <button
    onClick={() => void onClick()}
    className={`flex items-center w-full px-4 py-2 text-[11px] transition-colors gap-3 tracking-wider font-semibold uppercase ${menuButtonClassByTone[tone]}`}
  >
    <span className="material-symbols-outlined text-[16px]">{icon}</span>
    <span className={labelClassName}>{children}</span>
  </button>
)

interface LibraryContextMenuProps {
  menu: LibraryContextMenuState
  menuRef: React.RefObject<HTMLDivElement>
  selectedModCount: number
  separators: ModMetadata[]
  hasSeparators: boolean
  canMoveSelectedToTopLevel: boolean
  canMoveContextToTopLevel: boolean
  contextTargetCount: number
  onRefreshLibrary: MenuAction
  onCreateSeparatorHere: MenuAction
  onMoveSelectedToTopLevel: MenuAction
  onExpandAllSeparators: MenuAction
  onCollapseAllSeparators: MenuAction
  onOpenMoveToSeparator: MenuAction
  onCreateSeparatorBeforeRow: MenuAction
  onRename: MenuAction
  onOpenFolder: MenuAction
  onDelete: MenuAction
  onReinstall: MenuAction
  onDetails: MenuAction
  onMoveContextToTopLevel: MenuAction
  onOpenOnNexus: MenuAction
  onCheckUpdate: MenuAction
}

export const LibraryContextMenu: React.FC<LibraryContextMenuProps> = ({
  menu,
  menuRef,
  selectedModCount,
  separators,
  hasSeparators,
  canMoveSelectedToTopLevel,
  canMoveContextToTopLevel,
  contextTargetCount,
  onRefreshLibrary,
  onCreateSeparatorHere,
  onMoveSelectedToTopLevel,
  onExpandAllSeparators,
  onCollapseAllSeparators,
  onOpenMoveToSeparator,
  onCreateSeparatorBeforeRow,
  onRename,
  onOpenFolder,
  onDelete,
  onReinstall,
  onDetails,
  onMoveContextToTopLevel,
  onOpenOnNexus,
  onCheckUpdate,
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
      {menu.kind !== 'row' && (
        <>
          <MenuButton icon="refresh" onClick={onRefreshLibrary}>
            Refresh Library
          </MenuButton>
          <MenuDivider />
        </>
      )}

      {menu.kind === 'list' ? (
        <>
          <MenuButton icon="label" onClick={onCreateSeparatorHere}>
            Create Separator Here
          </MenuButton>
          {((selectedModCount > 0 && canMoveSelectedToTopLevel) || hasSeparators) && <MenuDivider />}
          {selectedModCount > 0 && canMoveSelectedToTopLevel && (
            <MenuButton icon="vertical_align_top" onClick={onMoveSelectedToTopLevel} tone="blue">
              Move Selected to Top Level
            </MenuButton>
          )}
          {hasSeparators && (
            <>
            <MenuButton icon="unfold_more" onClick={onExpandAllSeparators}>
              Expand All Separators
            </MenuButton>
            <MenuButton icon="unfold_less" onClick={onCollapseAllSeparators}>
              Collapse All Separators
            </MenuButton>
            </>
          )}
        </>
      ) : menu.mod.kind === 'separator' ? (
        <>
          {/* Edit */}
          <MenuButton icon="edit" onClick={onRename}>
            Rename Separator
          </MenuButton>

          {/* Separator structure */}
          <MenuDivider />
          <MenuButton icon="segment" onClick={onCreateSeparatorBeforeRow} tone="blue">
            Create Separator Before
          </MenuButton>
          {hasSeparators && (
            <>
            <MenuButton icon="unfold_more" onClick={onExpandAllSeparators} tone="blue">
              Expand All Separators
            </MenuButton>
            <MenuButton icon="unfold_less" onClick={onCollapseAllSeparators} tone="blue">
              Collapse All Separators
            </MenuButton>
            </>
          )}

          {/* Locate */}
          <MenuDivider />
          <MenuButton icon="folder_open" onClick={onOpenFolder}>
            Open in File Explorer
          </MenuButton>

          {/* Destructive */}
          <MenuDivider />
          <MenuButton icon="delete" onClick={onDelete} tone="danger">
            Delete Separator
          </MenuButton>
        </>
      ) : (
        <>
          {/* Inspect & edit */}
          <MenuButton icon="info" onClick={onDetails}>
            Details
          </MenuButton>
          <MenuButton icon="edit" onClick={onRename}>
            Rename
          </MenuButton>
          <MenuButton icon="settings_backup_restore" onClick={onReinstall}>
            Reinstall
          </MenuButton>

          {/* Organize */}
          <MenuDivider />
          <MenuButton icon="segment" onClick={onCreateSeparatorBeforeRow} tone="blue">
            Create Separator Before
          </MenuButton>
          {separators.length > 0 && (
            <MenuButton icon="move_item" onClick={onOpenMoveToSeparator} tone="blue">
              Move to Separator
            </MenuButton>
          )}
          {canMoveContextToTopLevel && (
            <MenuButton icon="vertical_align_top" onClick={onMoveContextToTopLevel} tone="blue">
              {contextTargetCount > 1 ? 'Move Selected to Top Level' : 'Move to Top Level'}
            </MenuButton>
          )}

          {/* Open & locate */}
          <MenuDivider />
          {menu.mod.nexusModId != null && (
            <MenuButton icon="update" onClick={onCheckUpdate}>
              Check for Update
            </MenuButton>
          )}
          {(menu.mod.nexusModId || menu.mod.nexusFileId) && (
            <MenuButton icon="open_in_new" onClick={onOpenOnNexus}>
              Open on Nexus
            </MenuButton>
          )}
          <MenuButton icon="folder_open" onClick={onOpenFolder}>
            Open in File Explorer
          </MenuButton>

          {/* Utility */}
          <MenuDivider />
          <MenuButton icon="refresh" onClick={onRefreshLibrary}>
            Refresh Library
          </MenuButton>

          {/* Destructive */}
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
