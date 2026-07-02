import React, { useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ModMetadata } from '@shared/types'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from '../ui/Icon'

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
  default: 'text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]',
  subtle: 'text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]',
  blue: 'text-[var(--text-secondary)] hover:bg-[rgb(var(--accent-rgb)/0.1)] hover:text-[var(--accent)]',
  danger: 'text-[var(--status-error)] hover:bg-[rgb(248_113_113/0.1)] hover:text-[var(--status-error)]',
  disable: 'text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--status-error)]',
}

const MenuDivider: React.FC = () => <div className="my-1 border-t border-[var(--border)]" />

const MenuButton: React.FC<{
  icon: string
  children: React.ReactNode
  onClick: MenuAction
  tone?: MenuButtonTone
  labelClassName?: string
}> = ({ icon, children, onClick, tone = 'default', labelClassName = '' }) => (
  <button
    onClick={() => void onClick()}
    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${menuButtonClassByTone[tone]}`}
  >
    <Icon name={icon} className="text-[18px]" />
    <span className={labelClassName}>{children}</span>
  </button>
)

interface LibraryContextMenuProps {
  menu: LibraryContextMenuState
  menuRef: React.RefObject<HTMLDivElement | null>
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
  const { t } = useTranslation()
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
      className="fixed z-[100] min-w-[224px] rounded-xl border border-[var(--border)] bg-[var(--overlay)] p-1.5 shadow-[0_16px_44px_rgba(0,0,0,0.55)]"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      {menu.kind !== 'row' && (
        <>
          <MenuButton icon="refresh" onClick={onRefreshLibrary}>
            {t('library.menu.refreshLibrary')}
          </MenuButton>
          <MenuDivider />
        </>
      )}

      {menu.kind === 'list' ? (
        <>
          <MenuButton icon="label" onClick={onCreateSeparatorHere}>
            {t('library.menu.createSeparatorHere')}
          </MenuButton>
          {((selectedModCount > 0 && canMoveSelectedToTopLevel) || hasSeparators) && <MenuDivider />}
          {selectedModCount > 0 && canMoveSelectedToTopLevel && (
            <MenuButton icon="vertical_align_top" onClick={onMoveSelectedToTopLevel} tone="blue">
              {t('library.menu.moveSelectedTopLevel')}
            </MenuButton>
          )}
          {hasSeparators && (
            <>
            <MenuButton icon="unfold_more" onClick={onExpandAllSeparators}>
              {t('library.menu.expandAll')}
            </MenuButton>
            <MenuButton icon="unfold_less" onClick={onCollapseAllSeparators}>
              {t('library.menu.collapseAll')}
            </MenuButton>
            </>
          )}
        </>
      ) : menu.mod.kind === 'separator' ? (
        <>
          {/* Edit */}
          <MenuButton icon="edit" onClick={onRename}>
            {t('library.menu.renameSeparator')}
          </MenuButton>

          {/* Separator structure */}
          <MenuDivider />
          <MenuButton icon="segment" onClick={onCreateSeparatorBeforeRow} tone="blue">
            {t('library.menu.createSeparatorBefore')}
          </MenuButton>
          {hasSeparators && (
            <>
            <MenuButton icon="unfold_more" onClick={onExpandAllSeparators} tone="blue">
              {t('library.menu.expandAll')}
            </MenuButton>
            <MenuButton icon="unfold_less" onClick={onCollapseAllSeparators} tone="blue">
              {t('library.menu.collapseAll')}
            </MenuButton>
            </>
          )}

          {/* Locate */}
          <MenuDivider />
          <MenuButton icon="folder_open" onClick={onOpenFolder}>
            {t('library.menu.openInExplorer')}
          </MenuButton>

          {/* Destructive */}
          <MenuDivider />
          <MenuButton icon="delete" onClick={onDelete} tone="danger">
            {t('library.menu.deleteSeparator')}
          </MenuButton>
        </>
      ) : (
        <>
          {/* Inspect & edit */}
          <MenuButton icon="info" onClick={onDetails}>
            {t('library.menu.details')}
          </MenuButton>
          <MenuButton icon="edit" onClick={onRename}>
            {t('library.menu.rename')}
          </MenuButton>
          <MenuButton icon="settings_backup_restore" onClick={onReinstall}>
            {t('common.reinstall')}
          </MenuButton>

          {/* Organize */}
          <MenuDivider />
          <MenuButton icon="segment" onClick={onCreateSeparatorBeforeRow} tone="blue">
            {t('library.menu.createSeparatorBefore')}
          </MenuButton>
          {separators.length > 0 && (
            <MenuButton icon="move_item" onClick={onOpenMoveToSeparator} tone="blue">
              {t('library.menu.moveToSeparator')}
            </MenuButton>
          )}
          {canMoveContextToTopLevel && (
            <MenuButton icon="vertical_align_top" onClick={onMoveContextToTopLevel} tone="blue">
              {contextTargetCount > 1 ? t('library.menu.moveSelectedTopLevel') : t('library.menu.moveToTopLevel')}
            </MenuButton>
          )}

          {/* Open & locate */}
          <MenuDivider />
          {menu.mod.nexusModId != null && (
            <MenuButton icon="update" onClick={onCheckUpdate}>
              {t('library.menu.checkForUpdate')}
            </MenuButton>
          )}
          {(menu.mod.nexusModId || menu.mod.nexusFileId) && (
            <MenuButton icon="open_in_new" onClick={onOpenOnNexus}>
              {t('library.menu.openOnNexus')}
            </MenuButton>
          )}
          <MenuButton icon="folder_open" onClick={onOpenFolder}>
            {t('library.menu.openInExplorer')}
          </MenuButton>

          {/* Utility */}
          <MenuDivider />
          <MenuButton icon="refresh" onClick={onRefreshLibrary}>
            {t('library.menu.refreshLibrary')}
          </MenuButton>

          {/* Destructive */}
          <MenuDivider />
          <MenuButton icon="delete" onClick={onDelete} tone="danger">
            {t('common.delete')}
          </MenuButton>
        </>
      )}
    </div>,
    document.body
  )
}
