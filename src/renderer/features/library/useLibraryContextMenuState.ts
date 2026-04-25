import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent, RefObject } from 'react'
import type { ModMetadata } from '@shared/types'
import type { LibraryContextMenuState } from './LibraryContextMenu'

interface UseLibraryContextMenuStateOptions {
  displayedModsLength: number
  listRowsRef: RefObject<HTMLDivElement>
  rowHeight: number
  selectMod: (modId: string | null) => void
}

export function useLibraryContextMenuState({
  displayedModsLength,
  listRowsRef,
  rowHeight,
  selectMod,
}: UseLibraryContextMenuStateOptions) {
  const [contextMenu, setContextMenu] = useState<LibraryContextMenuState | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const closeMenu = () => setContextMenu(null)
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') closeMenu()
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('blur', closeMenu)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('blur', closeMenu)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleRowContextMenu = useCallback((event: MouseEvent, mod: ModMetadata) => {
    event.preventDefault()
    event.stopPropagation()
    selectMod(mod.uuid)
    setContextMenu({ kind: 'row', mod, x: event.clientX, y: event.clientY })
  }, [selectMod])

  const handleListContextMenu = useCallback((event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-mod-row="true"]')) return

    event.preventDefault()
    event.stopPropagation()

    const rect = listRowsRef.current?.getBoundingClientRect()
    const localY = rect ? Math.max(0, event.clientY - rect.top) : 0
    const insertIndex = Math.max(0, Math.min(Math.floor(localY / rowHeight), displayedModsLength))
    setContextMenu({ kind: 'list', x: event.clientX, y: event.clientY, insertIndex })
  }, [displayedModsLength, listRowsRef, rowHeight])

  return {
    contextMenu,
    contextMenuRef,
    setContextMenu,
    closeContextMenu,
    handleRowContextMenu,
    handleListContextMenu,
  }
}
