import path from 'path'

// Loader files Hyperion copies into the game folder before launch (see stageBootstrapFile
// in index.ts). Pure so the cleanup rules can be unit-tested outside Electron.
export interface BootstrapStageEntry {
  source: string
  dest: string
  deployPath: string
  modName?: string
  modFolderName?: string
  status: 'copied' | 'already-present' | 'existing-kept' | 'error'
  error?: string
}

// Both 'copied' (Hyperion created the file) and 'already-present' (an identical loader a
// previous session staged and never removed) are Hyperion's own loaders, so cleanup must
// remove both. 'existing-kept' is a different file the user owns and is never touched.
export function isHyperionStagedEntry(entry: BootstrapStageEntry | null | undefined): boolean {
  return entry?.status === 'copied' || entry?.status === 'already-present'
}

// Merge staging left by a previous session (from the manifest) with this run's fresh
// staging, keyed on dest so a re-staged file keeps its newest entry. Anything that is not
// one of Hyperion's own loaders is dropped, since cleanup would ignore it anyway.
export function mergeStagedBootstrapEntries(
  previous: BootstrapStageEntry[] | undefined,
  current: BootstrapStageEntry[]
): BootstrapStageEntry[] {
  const byDest = new Map<string, BootstrapStageEntry>()
  for (const entry of [...(previous ?? []), ...current]) {
    if (!isHyperionStagedEntry(entry) || !entry.dest) continue
    byDest.set(path.normalize(entry.dest).toLowerCase(), entry)
  }
  return [...byDest.values()]
}
