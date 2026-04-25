import { useCallback, useState } from 'react'
import type { LibrarySortKey, SortDirection } from './LibraryTableHeader'

export function useLibrarySort() {
  const [sortKey, setSortKey] = useState<LibrarySortKey | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const handleSort = useCallback((nextKey: LibrarySortKey) => {
    if (sortKey === nextKey) {
      if (sortDirection === 'asc') {
        setSortDirection('desc')
      } else {
        setSortKey(null)
      }
      return
    }

    setSortKey(nextKey)
    setSortDirection('asc')
  }, [sortDirection, sortKey])

  const resetToCustomOrder = useCallback(() => {
    setSortKey(null)
    setSortDirection('asc')
  }, [])

  return {
    sortKey,
    sortDirection,
    handleSort,
    resetToCustomOrder,
  }
}
