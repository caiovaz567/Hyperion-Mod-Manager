import React from 'react'
import type { ConflictInfo, ModMetadata } from '@shared/types'
import { getModCategoryLabel } from '../../utils/modCategoryDisplay'
import { LIBRARY_GRID_TEMPLATE } from './LibraryTableHeader'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from '../ui/Icon'

interface LibraryConflictFloatingRowsProps {
  selectedMod: ModMetadata | null
  conflicts: ConflictInfo[]
  allMods: ModMetadata[]
  allSeparators: ModMetadata[]
  displayedMods: ModMetadata[]
  /**
   * The library's scroll container. This overlay tracks its scroll position
   * INTERNALLY (only while it actually has rows to show) so that scrolling does not
   * re-render the whole mod list every frame — only this small overlay updates.
   */
  scrollContainerRef: React.RefObject<HTMLElement | null>
  rowHeight: number
  loadOrderMap: Map<string, number>
  separatorParentByModId: Map<string, string>
  collapsedSeparatorSet: Set<string>
  onGoToMod: (modId: string) => void
}

type FloatingSide = 'top' | 'bottom'
type FloatingTone = 'win' | 'loss'

interface FloatingConflictMod {
  mod: ModMetadata
  tone: FloatingTone
  side: FloatingSide
  conflictCount: number
  hiddenInSeparator?: string
}

function collectRelatedMods(
  selectedMod: ModMetadata,
  conflicts: ConflictInfo[],
  allMods: ModMetadata[]
): Array<{ mod: ModMetadata; tone: FloatingTone; conflictCount: number }> {
  const modsById = new Map(allMods.map((mod) => [mod.uuid, mod]))
  const relationMap = new Map<string, { mod: ModMetadata; tone: FloatingTone; conflictCount: number }>()

  const addRelation = (modId: string | undefined, tone: FloatingTone) => {
    if (!modId) return
    const mod = modsById.get(modId)
    if (!mod) return
    const key = `${tone}:${mod.uuid}`
    const current = relationMap.get(key)
    if (current) {
      current.conflictCount += 1
      return
    }
    relationMap.set(key, { mod, tone, conflictCount: 1 })
  }

  for (const conflict of conflicts) {
    if (conflict.incomingModId === selectedMod.uuid) {
      addRelation(conflict.existingModId, 'win')
    }

    if (conflict.existingModId === selectedMod.uuid) {
      addRelation(conflict.incomingModId, 'loss')
    }
  }

  return Array.from(relationMap.values())
}

function getHiddenSeparatorName(
  modId: string,
  allSeparators: ModMetadata[],
  separatorParentByModId: Map<string, string>,
  collapsedSeparatorSet: Set<string>
): string | undefined {
  const parentId = separatorParentByModId.get(modId)
  if (!parentId || !collapsedSeparatorSet.has(parentId)) return undefined
  return allSeparators.find((separator) => separator.uuid === parentId)?.name ?? 'separator'
}

export const LibraryConflictFloatingRows: React.FC<LibraryConflictFloatingRowsProps> = ({
  selectedMod,
  conflicts,
  allMods,
  allSeparators,
  displayedMods,
  scrollContainerRef,
  rowHeight,
  loadOrderMap,
  separatorParentByModId,
  collapsedSeparatorSet,
  onGoToMod,
}) => {
  const { t } = useTranslation()

  // Will this overlay actually render anything? Only a selected mod that participates
  // in at least one conflict can produce floating rows. We use this to decide whether
  // to bother tracking scroll at all — when there's nothing to show, we attach no
  // listener and never re-render on scroll.
  const overlayActive =
    Boolean(selectedMod && selectedMod.kind === 'mod') &&
    conflicts.some(
      (conflict) =>
        conflict.incomingModId === selectedMod!.uuid || conflict.existingModId === selectedMod!.uuid
    )

  // Track the scroll container's position locally (rAF-throttled) so that scrolling
  // re-renders ONLY this lightweight overlay — never the full mod list. This is the
  // key to smooth scrolling while a conflicting mod is selected.
  const [viewport, setViewport] = React.useState({ scrollTop: 0, height: 0 })
  React.useEffect(() => {
    if (!overlayActive) return
    const element = scrollContainerRef.current
    if (!element) return

    let frame = 0
    const measure = () => {
      frame = 0
      setViewport({ scrollTop: element.scrollTop, height: element.clientHeight })
    }
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure)
    }

    measure()
    element.addEventListener('scroll', schedule, { passive: true })
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      element.removeEventListener('scroll', schedule)
    }
  }, [overlayActive, scrollContainerRef])

  const visibleStartIndex = Math.max(0, Math.floor(viewport.scrollTop / rowHeight))
  const visibleEndIndex =
    viewport.height > 0
      ? visibleStartIndex + Math.ceil(viewport.height / rowHeight)
      : displayedMods.length

  // Who this mod wins over / loses to. This scans the (potentially very large) conflicts
  // array, so it MUST NOT depend on scroll position — it's memoized on the selection +
  // conflicts only, so scrolling never re-runs it.
  const relatedMods = React.useMemo(() => {
    if (!selectedMod || selectedMod.kind !== 'mod') return []
    return collectRelatedMods(selectedMod, conflicts, allMods)
  }, [selectedMod, conflicts, allMods])

  // O(1) row-index lookups so the per-scroll visibility pass below is O(related mods)
  // instead of a findIndex scan over every displayed row per related mod.
  const displayIndexByUuid = React.useMemo(() => {
    const map = new Map<string, number>()
    displayedMods.forEach((mod, index) => map.set(mod.uuid, index))
    return map
  }, [displayedMods])

  // The ONLY part that depends on scroll. Kept deliberately cheap (a loop over the few
  // related mods) so a scroll frame does no heavy work.
  const floatingMods = React.useMemo<FloatingConflictMod[]>(() => {
    if (!selectedMod || selectedMod.kind !== 'mod' || relatedMods.length === 0) return []

    const selectedOrder = loadOrderMap.get(selectedMod.uuid) ?? selectedMod.order
    const rows: FloatingConflictMod[] = []

    for (const relation of relatedMods) {
      const displayIndex = displayIndexByUuid.get(relation.mod.uuid) ?? -1

      if (displayIndex >= visibleStartIndex && displayIndex < visibleEndIndex) {
        continue
      }

      const relationOrder = loadOrderMap.get(relation.mod.uuid) ?? relation.mod.order
      const side: FloatingSide = displayIndex >= 0
        ? displayIndex < visibleStartIndex ? 'top' : 'bottom'
        : relationOrder < selectedOrder ? 'top' : 'bottom'
      const hiddenInSeparator = getHiddenSeparatorName(
        relation.mod.uuid,
        allSeparators,
        separatorParentByModId,
        collapsedSeparatorSet
      )

      rows.push({
        ...relation,
        side,
        ...(hiddenInSeparator ? { hiddenInSeparator } : {}),
      })
    }

    return rows.sort((left, right) => {
      if (left.side !== right.side) return left.side === 'top' ? -1 : 1
      return (loadOrderMap.get(left.mod.uuid) ?? left.mod.order) - (loadOrderMap.get(right.mod.uuid) ?? right.mod.order)
    })
  }, [
    relatedMods,
    displayIndexByUuid,
    allSeparators,
    collapsedSeparatorSet,
    loadOrderMap,
    selectedMod,
    separatorParentByModId,
    visibleEndIndex,
    visibleStartIndex,
  ])

  const topRows = floatingMods.filter((mod) => mod.side === 'top')
  const bottomRows = floatingMods.filter((mod) => mod.side === 'bottom')

  if (topRows.length === 0 && bottomRows.length === 0) return null

  const renderStack = (rows: FloatingConflictMod[], side: FloatingSide) => {
    const visibleRows = side === 'top' ? rows.slice(-2) : rows.slice(0, 2)
    const hiddenCount = Math.max(0, rows.length - visibleRows.length)
    const stackRows = side === 'top' ? visibleRows : [...visibleRows].reverse()

    return (
      <div
        className={`pointer-events-none absolute left-0 right-0 z-30 px-0 ${
          side === 'top' ? 'top-8' : 'bottom-0'
        }`}
      >
        <div className={`flex flex-col ${side === 'top' ? '' : 'flex-col-reverse'}`}>
          {hiddenCount > 0 ? (
            <div className="mx-2 mb-1 inline-flex h-6 w-fit items-center rounded-md bg-[var(--surface)] px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9a9586] shadow-[0_10px_24px_rgba(0,0,0,0.58)]">
              {side === 'top' ? t('library.conflict.moreAbove', { count: hiddenCount }) : t('library.conflict.moreBelow', { count: hiddenCount })}
            </div>
          ) : null}
          {stackRows.map((row) => {
            const accent = row.tone === 'win' ? '#34d399' : '#f87171'
            const loadOrder = loadOrderMap.get(row.mod.uuid)
            const category = getModCategoryLabel(row.mod)
            return (
              <button
                key={`${row.tone}:${row.mod.uuid}`}
                type="button"
                data-conflict-floating-row="true"
                onClick={() => onGoToMod(row.mod.uuid)}
                className="pointer-events-auto group mx-0 grid h-[38px] w-full items-center gap-4 border-y px-5 text-left transition-colors hover:brightness-110"
                style={{
                  gridTemplateColumns: LIBRARY_GRID_TEMPLATE,
                  background: `linear-gradient(90deg, ${accent}20 0, var(--surface) 86px, var(--surface) 100%)`,
                  borderColor: `${accent}36`,
                  boxShadow: `inset 3px 0 0 ${accent}, inset 0 0 0 1px rgba(255,255,255,0.035), 0 14px 32px rgba(0,0,0,0.72)`,
                }}
                title={t('library.conflict.goTo', { name: row.mod.name })}
              >
                <div className="flex items-center pl-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: accent, boxShadow: `0 0 10px ${accent}88` }} />
                </div>
                <div className="flex items-center font-mono text-[12px] text-[#8a8a8a]">
                  {loadOrder ?? row.mod.order + 1}
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-flex h-5 min-w-[26px] items-center justify-center rounded-md px-1.5 font-mono text-[11px] font-bold"
                    style={{ color: accent, background: `${accent}1f` }}
                  >
                    {row.tone === 'win' ? '+' : '-'}{row.conflictCount}
                  </span>
                  <span className="min-w-0 truncate text-[13px] font-semibold text-[#f1ede8]">
                    {row.mod.name}
                  </span>
                  {row.hiddenInSeparator ? (
                    <span className="shrink-0 rounded-md bg-[rgb(var(--accent-cyber-blue-rgb)/0.10)] px-1.5 py-[2px] text-[9px] font-semibold uppercase tracking-[0.14em] text-[#7fe6ff]">
                      {row.hiddenInSeparator}
                    </span>
                  ) : null}
                </div>
                <div className="truncate font-mono text-[12px] text-[#aaa]">
                  {row.mod.version ?? '-'}
                </div>
                <div className="truncate text-[12px] text-[#8d8d8d]">
                  {category}
                </div>
                <div className="flex min-w-0 items-center font-mono text-[12px] text-[#908b80]">
                  <span className="truncate whitespace-nowrap">
                    {row.tone === 'win' ? t('library.conflict.losesToSelected') : t('library.conflict.winsOverSelected')}
                  </span>
                </div>
                <div className="flex items-center justify-end">
                  <span className="inline-flex h-7 min-w-[58px] items-center justify-center gap-1 rounded-md bg-[rgb(var(--accent-rgb)/0.18)] px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)] shadow-[0_0_14px_rgb(var(--accent-rgb)/0.10)] transition-colors group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-foreground)] group-hover:shadow-none">
                    <Icon name={row.side === 'top' ? 'keyboard_double_arrow_up' : 'keyboard_double_arrow_down'} className="text-[15px] leading-none text-current" />
                    {t('library.conflict.go')}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      {topRows.length > 0 ? renderStack(topRows, 'top') : null}
      {bottomRows.length > 0 ? renderStack(bottomRows, 'bottom') : null}
    </>
  )
}
