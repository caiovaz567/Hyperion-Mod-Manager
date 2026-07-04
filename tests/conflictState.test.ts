import { describe, expect, it } from 'vitest'
import { recomputeConflictStateFromExistingConflicts } from '../src/renderer/utils/modConflictState'
import type { ConflictInfo, ModMetadata } from '../src/shared/types'

function makeMod(overrides: Partial<ModMetadata> = {}): ModMetadata {
  return {
    uuid: 'uuid',
    kind: 'mod',
    name: 'Mod',
    folderName: 'Mod',
    type: 'archive',
    enabled: true,
    order: 1,
    files: [],
    ...overrides,
  } as ModMetadata
}

// One pairwise overwrite row; the recompute regroups owners per resource from these.
function makeConflict(overrides: Partial<ConflictInfo> = {}): ConflictInfo {
  return {
    kind: 'overwrite',
    resourcePath: 'r6/scripts/shared.reds',
    existingModId: 'a',
    existingModName: 'Mod A',
    incomingModId: 'b',
    incomingModName: 'Mod B',
    existingOrder: 1,
    incomingOrder: 2,
    incomingWins: true,
    ...overrides,
  } as ConflictInfo
}

const summaryOf = (snapshot: ReturnType<typeof recomputeConflictStateFromExistingConflicts>, modId: string) =>
  snapshot.summaries.find((summary) => summary.modId === modId)!

describe('recomputeConflictStateFromExistingConflicts', () => {
  it('three identical mods: unique-resource counts, middle mod shows +1/-1, earlier copies redundant', () => {
    const mods = [
      makeMod({ uuid: 'a', name: 'Mod A', order: 1, trackedResourceCount: 1 }),
      makeMod({ uuid: 'b', name: 'Mod B', order: 2, trackedResourceCount: 1 }),
      makeMod({ uuid: 'c', name: 'Mod C', order: 3, trackedResourceCount: 1 }),
    ]
    // Two adjacent rows are enough - the recompute groups all owners of the resource.
    const snapshot = recomputeConflictStateFromExistingConflicts(mods, [
      makeConflict({ existingModId: 'a', incomingModId: 'b' }),
      makeConflict({ existingModId: 'b', incomingModId: 'c', existingOrder: 2, incomingOrder: 3 }),
    ])

    expect(summaryOf(snapshot, 'a')).toMatchObject({ overwrites: 0, overwrittenBy: 1, redundant: true })
    expect(summaryOf(snapshot, 'b')).toMatchObject({ overwrites: 1, overwrittenBy: 1, redundant: true })
    expect(summaryOf(snapshot, 'c')).toMatchObject({ overwrites: 1, overwrittenBy: 0, redundant: false })

    // Pairwise expansion: every lower/higher owner pair, not just loser -> final winner.
    const pairs = snapshot.conflicts.map((conflict) => `${conflict.existingModId}->${conflict.incomingModId}`)
    expect(pairs.sort()).toEqual(['a->b', 'a->c', 'b->c'])
    expect(snapshot.conflicts.every((conflict) => conflict.incomingWins)).toBe(true)
  })

  it('a partially overwritten mod is NOT redundant', () => {
    const mods = [
      // Mod A tracks two resources but only one is contested.
      makeMod({ uuid: 'a', name: 'Mod A', order: 1, trackedResourceCount: 2 }),
      makeMod({ uuid: 'b', name: 'Mod B', order: 2, trackedResourceCount: 1 }),
    ]
    const snapshot = recomputeConflictStateFromExistingConflicts(mods, [makeConflict()])

    expect(summaryOf(snapshot, 'a')).toMatchObject({ overwrites: 0, overwrittenBy: 1, redundant: false })
    expect(summaryOf(snapshot, 'b')).toMatchObject({ overwrites: 1, overwrittenBy: 0, redundant: false })
  })

  it('counts unique resources, not conflict rows', () => {
    const mods = [
      makeMod({ uuid: 'a', name: 'Mod A', order: 1, trackedResourceCount: 2 }),
      makeMod({ uuid: 'b', name: 'Mod B', order: 2, trackedResourceCount: 2 }),
    ]
    const snapshot = recomputeConflictStateFromExistingConflicts(mods, [
      makeConflict({ resourcePath: 'r6/scripts/one.reds' }),
      makeConflict({ resourcePath: 'r6/scripts/two.reds' }),
      // Duplicate row for resource one - must not double-count.
      makeConflict({ resourcePath: 'r6/scripts/one.reds' }),
    ])

    expect(summaryOf(snapshot, 'a')).toMatchObject({ overwrites: 0, overwrittenBy: 2, redundant: true })
    expect(summaryOf(snapshot, 'b')).toMatchObject({ overwrites: 2, overwrittenBy: 0 })
  })

  it('drops disabled mods from conflict groups entirely', () => {
    const mods = [
      makeMod({ uuid: 'a', name: 'Mod A', order: 1, trackedResourceCount: 1 }),
      makeMod({ uuid: 'b', name: 'Mod B', order: 2, enabled: false, trackedResourceCount: 1 }),
    ]
    const snapshot = recomputeConflictStateFromExistingConflicts(mods, [makeConflict()])

    expect(snapshot.conflicts).toEqual([])
    expect(summaryOf(snapshot, 'a')).toMatchObject({ overwrites: 0, overwrittenBy: 0, redundant: false })
  })

  it('groups archive-resource conflicts by hash and keeps the kind on recomputed rows', () => {
    const mods = [
      makeMod({ uuid: 'a', name: 'Mod A', order: 1, trackedResourceCount: 1 }),
      makeMod({ uuid: 'b', name: 'Mod B', order: 2, trackedResourceCount: 1 }),
    ]
    const snapshot = recomputeConflictStateFromExistingConflicts(mods, [
      makeConflict({
        kind: 'archive-resource',
        resourcePath: 'base/characters/body.mesh',
        hash: '00a1b2c3d4e5f607',
      }),
    ])

    expect(snapshot.conflicts).toHaveLength(1)
    expect(snapshot.conflicts[0]).toMatchObject({
      kind: 'archive-resource',
      hash: '00a1b2c3d4e5f607',
      existingModId: 'a',
      incomingModId: 'b',
      incomingWins: true,
    })
    expect(summaryOf(snapshot, 'a').redundant).toBe(true)
  })

  it('load order decides direction regardless of the order in the input rows', () => {
    const mods = [
      makeMod({ uuid: 'a', name: 'Mod A', order: 5, trackedResourceCount: 1 }),
      makeMod({ uuid: 'b', name: 'Mod B', order: 2, trackedResourceCount: 1 }),
    ]
    // Input row claims a -> b, but B loads earlier (order 2 < 5): A must win.
    const snapshot = recomputeConflictStateFromExistingConflicts(mods, [makeConflict()])

    expect(snapshot.conflicts).toHaveLength(1)
    expect(snapshot.conflicts[0]).toMatchObject({ existingModId: 'b', incomingModId: 'a', incomingWins: true })
    expect(summaryOf(snapshot, 'a')).toMatchObject({ overwrites: 1, overwrittenBy: 0, redundant: false })
    expect(summaryOf(snapshot, 'b')).toMatchObject({ overwrites: 0, overwrittenBy: 1, redundant: true })
  })

  it('slim mods (trackedResourceCount, no files) never go redundant below the real denominator', () => {
    const mods = [
      makeMod({ uuid: 'a', name: 'Mod A', order: 1, trackedResourceCount: 3 }),
      makeMod({ uuid: 'b', name: 'Mod B', order: 2, trackedResourceCount: 3 }),
    ]
    const oneOfThree = recomputeConflictStateFromExistingConflicts(mods, [makeConflict()])
    expect(summaryOf(oneOfThree, 'a').redundant).toBe(false)

    const allThree = recomputeConflictStateFromExistingConflicts(mods, [
      makeConflict({ resourcePath: 'p/one' }),
      makeConflict({ resourcePath: 'p/two' }),
      makeConflict({ resourcePath: 'p/three' }),
    ])
    expect(summaryOf(allThree, 'a').redundant).toBe(true)
  })
})
