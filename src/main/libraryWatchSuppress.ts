// Shared suppression window so the recursive mod-library watcher (startLibraryWatcher in
// index.ts) ignores the filesystem events caused by Hyperion's OWN writes - chiefly the
// `_metadata.json` and `_archive_resources.json` files written during scans and conflict
// refreshes.
//
// The watcher already skips events whose filename is one of those bookkeeping files, but
// writing a file inside a mod folder ALSO produces a directory-level change event (the
// folder's own mtime), whose filename is the folder - which the name filter can't catch.
// That escaped event made a metadata-refreshing scan write files -> watcher fires
// LIBRARY_CHANGED -> renderer re-scans (refreshFileMetadata) -> writes again -> an infinite
// loop that froze the app (confirmed via render counters).
//
// The write helpers in modManager extend this window on every write; the watcher checks it
// before emitting. Genuine external edits happen when the app is NOT writing, so they fall
// outside the window and still surface.
let suppressUntilMs = 0

/** Suppress library-watcher emissions for `durationMs` from now (windows extend, never shrink). */
export function suppressLibraryWatch(durationMs = 2000): void {
  const until = Date.now() + durationMs
  if (until > suppressUntilMs) suppressUntilMs = until
}

/** True while a self-write suppression window is active. */
export function isLibraryWatchSuppressed(): boolean {
  return Date.now() < suppressUntilMs
}
