# Changelog

All notable changes to Hyperion are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

- **The WolvenKit resource-hash database parses ~2x faster and no longer sits in RAM when it isn't needed.** Conflict detection cross-references a bundled ~30 MB / 1.7-million-row hash database. Its parse was rewritten to read the already-normalized CSV directly instead of re-running per-row normalization on all 1.7M rows (verified byte-for-byte identical output), cutting it from ~1.5s to ~0.8s, and it yields between chunks so it never freezes the app while loading. It also loads strictly on demand again (on the first install/re-index or when a mod's conflict names are resolved) rather than eagerly at startup — because conflict detection now treats an already-indexed mod as final, the launch path never needs the database, so an idle session no longer holds a few hundred MB for a lookup table it won't use.

### Changed
- **The splash screen now shows real, moving progress instead of freezing on a single label.** The root cause was a bug: the helper that updates the splash text ran `const s = …` at the top of an injected script, and because every injection shares the splash page's top-level scope, the *second* update onward threw "Identifier 's' has already been declared" — silently swallowed — so the splash only ever displayed its very first line ("Loading settings…", and every later step was dropped). That's fixed (the script is now function-scoped), and on top of it the boot sequence reports what's actually happening, live: "Starting Hyperion…" during main-process startup, then real per-mod counters as it works ("Scanning library · 45/105", "Checking conflicts · 45/105") and labelled steps in between. The mod scan and conflict pass yield to the splash mid-work (only during boot) so the counter actually advances on screen rather than jumping at the end, and every progress update also doubles as a "still alive" heartbeat for the boot safety net.
- **Deleting a mod now removes the runtime files it left behind.** When mods run, tools like CET and RED4ext write per-mod settings/configs into the game folder, which Hyperion captures into the Runtime Captures (Overwrite) folder so they survive between sessions. Those captures used to linger forever even after the owning mod was deleted, slowly piling up (hundreds of files from mods you no longer have). Deleting a mod now also removes its leftover captures. The Runtime Captures folder otherwise stays a single, always-active catch-all (the same model as Mod Organizer 2's Overwrite) — captures are **never** moved, parked, or hidden based on enable/disable state, so nothing a mod generates is ever relocated behind your back. The cleanup is deliberately conservative: it only deletes files inside the deleted mod's own private folder (its CET-mod or RED4ext-plugin subfolder), never files at the root of a shared framework folder (e.g. `cyber_engine_tweaks/`) or anything used by other mods. Use the **Clear captures** button in Settings to wipe the folder manually whenever you want.
- **Files added or removed directly inside a mod's folder now show up.** For speed, Hyperion reuses each mod's stored file list on routine scans and never re-walks the folder — so dropping a folder (e.g. `bin/`) into a mod via Explorer didn't appear in that mod's Files tab. Now opening a mod's details re-reads its files from disk, and a new recursive watcher on the mod library refreshes the view live when files change externally (mirroring the existing Downloads-folder watcher). The watcher ignores Hyperion's own metadata/sidecar writes so refreshing never loops.
- **Installing a mod no longer hangs on "checking conflicts" while it resolves archive resource names.** Conflict detection only needs each `.archive` resource's hash, but the installer was also eagerly resolving those hashes into readable resource paths for the inspector — which means spawning PowerShell to read per-archive LXRS tables and external `.kark` databases. That display-only work, on the critical path of every install and index pass, is what made installs sit on "checking conflicts" for a long time. Name resolution is now split out: indexing/install resolves names from the in-memory hash database only (instant, no PowerShell), and the slow external tooling runs lazily, on demand, only when you actually open a mod's conflict inspector and it still has unresolved hashes (cached afterwards, at most once per mod per session). Conflicts are detected by hash, so nothing about conflict accuracy changes — resources whose names aren't in the database simply show their raw hash until you view them, then resolve in place.

### Performance
- **The app window opens noticeably faster on a large library.** The splash used to sit on "Ready" for a moment before the window appeared because the library rendered *every* mod row at once (100+ rich rows = thousands of DOM nodes) before revealing. The list now windows itself — rendering only the visible rows plus a small buffer — so the first paint touches ~30–50 rows instead of all of them. Crucially, the scroll-position state that drives windowing was moved out of the big `ModList` and into the small row-list component, so scrolling re-renders only that row list (never the whole library view). That removes the per-scroll-frame cost that previously made windowing not worth enabling for normal libraries, so scrolling stays smooth even with windowing on.
- **Creating, renaming, or deleting an item in a mod's Files tab is now instant instead of taking a moment.** Each of those actions re-read **every file of every installed mod** from disk before returning (and a second time, plus a redeploy, for enabled mods), then the renderer re-scanned the whole library and recomputed all conflicts before closing the dialog — so on a large library a simple "new folder" stalled noticeably. Now only the edited mod is refreshed from disk (the deployment is virtual and needs no resync), the renderer updates just that one mod so the tree repaints immediately, and the full library/conflict sync runs in the background without blocking the action.
- **Scrolling/dragging the scrollbar in a large library no longer stutters.** Three compounding causes: (1) the mod rows skip painting when off-screen via `content-visibility`, but their reserved placeholder height was `54px` while rows are actually `38px` — so every row visibly resized as it scrolled into view, shifting everything below it and making the scrollbar jump each frame (worst when dragging the thumb). The placeholder now matches the real height. (2) The virtualization helper tracked scroll position in React state even when virtualization was off (it is below ~120 mods), forcing a re-render of the whole list on every scroll frame; it now only does so when actually windowing rows. (3) The floating "jump to conflicting mod" overlay needed the scroll position, which dragged the whole list's re-render along with it; it now tracks the scroll container itself, so only that small overlay updates while scrolling. None of this was related to how many conflicts exist.

### Fixed
- **The splash no longer logs a false "Renderer did not signal APP_READY in time" warning on a slow (but healthy) start.** The safety net that guarantees the window reveals even if boot hangs was an absolute 12-second deadline from first paint — but a large library can legitimately boot for longer than that while progressing fine (scanning 100+ mods, first-run conflict re-index), so it fired the warning and revealed early even though nothing was stuck. It is now an inactivity watchdog: every boot-status update ("Loading settings…", "Scanning mod library…", "Checking mod conflicts…") re-arms the timer, so it only triggers after the renderer goes genuinely silent for the whole grace period — the real "stuck on the splash" hang it was meant to catch.
- **Fixed an infinite re-render loop that froze the app (especially while a mod with conflicts was selected).** The recursive mod-library watcher emitted `LIBRARY_CHANGED` whenever files changed; the renderer reacted by re-scanning with a file-metadata refresh, which rewrites each mod's `_metadata.json` / `_archive_resources.json`. The watcher's name filter skipped those files, but writing a file inside a mod folder also fires a *directory-level* event (the folder's own mtime) whose filename is the folder — which slipped past the filter and re-triggered the scan, looping forever (the library re-scanned and recomputed conflicts thousands of times per second). Hyperion's own writes now open a brief self-write suppression window that the watcher respects, so a refresh can no longer trigger itself; genuine external edits still surface. Also made the conflict-highlight store action idempotent (it no longer creates a new object when nothing changed) to remove a second way the same situation could spin.
- **The app no longer gets stuck forever on the splash ("LOADING SETTINGS…").** The window was only revealed once the renderer finished booting and sent its "ready" signal; if that boot stalled on a slow or hung IPC the signal never came and the splash stayed up indefinitely. A safety net now reveals the window a few seconds after it can first paint, regardless of the renderer's boot state, so a stalled boot can no longer trap you on the splash.
- **Conflict badges no longer take many seconds to appear on the first conflict check of each session.** The biggest cause of the "wait a while for the icon" problem was that a mod already indexed at the current sidecar version was still being re-resolved on every launch and every conflict refresh if it had any *unresolved* archive hashes. A single popular mod can contribute thousands of such hashes (e.g. Appearance Menu Mod ≈ 2.7k), and re-resolving them spawned a `resolve-kark-hashes` PowerShell process per 250 hashes per `.kark` file found on disk — easily ~24 PowerShell launches against CET's TweakDB `.kark` files, which can't resolve resource hashes anyway. That ran once per session (then cached in memory, which is why the *second* reinstall felt instant) and blocked the first conflict pass / the first reinstall's "checking conflicts" for many seconds. An already-indexed sidecar is now treated as final and skipped entirely — the expensive resolution still runs once at install time (and after a sidecar-format bump), but never again on routine launches/refreshes. Conflicts are detected by hash, not by resolved path, so badges are unaffected; the only difference is that genuinely unresolvable resources keep showing as "Unresolved" in the inspector (as they already did). This is the root-cause fix behind the slow-icon reports.
- **Conflict badges are present the moment the window opens, instead of popping in a second or two after launch.** The startup conflict pass had been changed to fire-and-forget (`void`), so the main window revealed before the badges were computed and the `+N`/`-N`/`!` icons appeared a moment later — a regression against 0.28.0, which waited for the conflict pass before showing the window. Startup now waits for the conflict pass again, but only for its cheap first phase: the conflict refresh resolves its awaitable as soon as the badges are on screen (computed from already-indexed sidecars), and the slow deep phase — which can parse `.archive` files and run external hash tooling — continues to refine in the background after the window is shown. Previously awaiting the whole thing could freeze the splash on a large library or a first-run re-index. A safety cap (6s) lets boot proceed regardless, so a pathologically slow scan can never trap the splash. (Reinstalling a mod already keeps it in its original list position here — that part of 0.28.0's behavior was the one thing it got wrong, and it's correct now.)
- **Conflict badges no longer disappear after reinstalling a mod.** Reinstalling (Replace) refreshes the library by re-scanning from disk, but the `+N`/`-N`/`!` conflict badges are renderer-computed state that the on-disk metadata doesn't carry — so the re-scan blanked every badge until the asynchronous conflict refresh landed. On the first reinstall after launch that refresh is queued behind the slow first-run deep archive-hash pass, so the badges stayed gone "for a while" (and only reappeared after clicking around long enough for that pass to finish); subsequent reinstalls looked fine because the hash cache was warm. The re-scan now carries each mod's existing conflict summary over by uuid (reinstall/replace preserves the uuid), so badges stay stable through the reinstall and the scheduled refresh simply corrects them when it runs.

---

## [0.30.2] - 2026-06-29

### Changed
- **Launch no longer re-checks Nexus for mod updates if it already did so within the last hour.** The cached update indicators are shown instantly on every launch regardless; previously the app also fired a fresh `updated.json` request on *every* launch, so rapid relaunches each hit Nexus needlessly. A recency gate now reuses the still-fresh cache for quick relaunches, while a normal session gap (closed earlier, reopened later) still gets a fresh check. The manual "Check Updates" button and per-mod checks are unaffected — they always run. Additionally, a launch check that's skipped for a missing API key no longer advances the cache timestamp, so adding a key later isn't suppressed by the gate.

### Fixed
- **The mouse no longer flickers to the "no-drop" block cursor while dragging mods/separators in the library.** Allowing a drop requires cancelling **both** `dragenter` and `dragover`; only `dragover` was being cancelled. `dragenter` fires every time the cursor crosses into a new element — and a row is full of small ones (cells, icons, text) — so the block cursor flashed on every micro-movement before `dragover` restored the move cursor, producing a constant flicker. While an internal drag is active, a single document-level listener now cancels both events for the whole window, giving a steady "move" cursor for the duration of the drag.
- **Dragging a separator now shows a single, concise section-boundary indicator instead of a flickering bar.** When you drag a separator over another section, the cyan bar snaps to a whole-section boundary and flips exactly once, at the section's mid-point: while the cursor is in the top half of the section the bar sits above the section header (the separator will land before it); once past the mid-point it jumps to below the section's last mod (the separator will land after the entire block). Previously the bar teleported between the header and the group's far edge every time the cursor crossed any row's midpoint, making it flash rapidly up and down. The indicator and the actual drop result are now always the same, and the decision respects collapsed/filtered sections (it uses the visible mods you actually see).
- **Dragging a separator onto a mod inside another separator no longer nests it there.** Separators cannot live inside other separators, so a dragged separator always lands at a whole-section boundary (before the header or after the entire block) rather than splitting the group or stealing its mods.
- **Selecting text in the separator name dialog no longer closes it.** Clicking and dragging inside the name input to select text could land the mouse release on the backdrop overlay, triggering the close handler. The backdrop now only closes the dialog when both the press and the release happened on the backdrop itself — not when a drag originated inside the input. Same fix applied to the Move to Separator search dialog.
- **Moving a separator below another separator no longer steals its mods.** Dragging an empty separator (e.g., "Teste") and dropping it below another separator (e.g., "CHAR APPEARANCE") with 20 mods used to splice "Teste" between CHAR APPEARANCE's header and its mods, making all 20 mods appear to belong to "Teste". The drag-and-drop now correctly inserts after the target separator's last child mod, keeping each separator's mod group intact. The drop indicator line is also now shown at the correct position (after the last child).
- **The interface now scales uniformly to your monitor's resolution.** Previously the window grew/shrank with the display but the UI itself stayed at fixed pixel sizes, so 1080p screens got a cramped layout with truncated table columns (`Down…`) while 4K screens got a tiny, sparse UI. Hyperion now applies a single resolution-proportional zoom (relative to a 1440p baseline) so 1080p, 1440p, and 4K all render the same logical layout — just physically larger or smaller. It accounts for OS display scaling and re-applies when the window moves to another monitor or the display configuration changes.

---

## [0.30.1] - 2026-06-29

### Changed
- Nexus requests now send a descriptive, fully dynamic `User-Agent` (`Hyperion/{version} ({OS} {release}; {arch}) Electron/{version}`) instead of the minimal `Hyperion-{version}` string, matching the format recommended for Nexus API clients. Every field is derived at runtime, so a `package.json` version bump is all that's needed — no manual edits.

### Fixed
- The Nexus CDN file download now sends the same `User-Agent` header as the API calls. Previously the actual archive download went out with a blank `User-Agent`, which the Nexus API Acceptable Use Policy discourages.

---

## [0.30.0] - 2026-06-29

### Added
- **Interface language selector (internationalization).** Hyperion can now be displayed in multiple languages. A language dropdown appears in two places: the first-run setup wizard (top-right of the welcome/onboarding screen) and **Settings > General**. The choice persists across sessions in app settings (`language`) and applies live without a restart. The **entire interface is now translatable** — app shell, Downloads, Library (mod details, conflicts, and all dialogs), every Settings tab, the FOMOD installer, the shared install/conflict/version dialogs, App Logs, and toasts all read from the translation catalog; only main-process error strings remain English. English is the source of truth (`en.json`); a **complete Brazilian Portuguese (Português Brasil)** catalog now ships at full key parity (712/712), and any untranslated string still falls back to English so the app always stays readable. New languages can be added by dropping a JSON catalog into `src/renderer/i18n/locales/` and registering it in `locales.ts` — no other code changes required.

### Fixed
- Several previously-hardcoded English strings are now translatable: all Library action toasts (install/delete/rename/move/enable/disable, drag-and-drop, separator actions), the Downloads delete-row status badge, the FOMOD installer's fallback module/step/group/plugin names, and the path validation "no folder selected" label.

### Removed
- Deleted four unused legacy components that were no longer rendered anywhere (`StatusBar`, `ModCard`, `LibraryPathSnackbar`, `ViewBackButton`) and the now-orphaned `statusMessage`/`setStatus` store state they depended on.

---

## [0.29.2] - 2026-06-28

### Added
- Collapsed separators now show a cyber-blue `upgrade N` badge when any child mod has an update available, so pending updates are visible without expanding every group.

### Fixed
- First-run setup can no longer be skipped silently. The welcome wizard now stays visible until the user explicitly clicks **Finish setup** (tracked by a new persisted `setupCompleted` flag), instead of disappearing the moment the game and library paths happen to validate. Previously, if a user ran "Detect automatically" before Cyberpunk 2077 was installed, the auto-detected game path was saved during boot and — once the game was later installed — the next launch went straight to the library, bypassing the wizard. Existing installs with a configured game path are treated as already onboarded, so they are not pushed back through setup.

---

## [0.29.1] - 2026-06-28

### Fixed
- `npm install` on Node 24 no longer fails to extract the Electron binary — added `overrides` for `yauzl@^3.0.0` (forces the `extract-zip` postinstall to use yauzl 3.x, which handles the Node 24 stream API correctly) and `cacache`→`glob@^13.0.0` (eliminates the deprecated glob@10 warning from node-gyp).
- Upgraded `electron-builder` to `^26` and `electron-updater` to `^6.8.9` to remove transitive deprecated packages (`tar@6`, `glob@7`/`@10`, `inflight`, `rimraf@2`).
- Bumped `node-gyp` to `^11` so native builds use `tar@7` and the modern `tinyglobby` resolver instead of the deprecated `glob@7`.

---

## [0.29.0] - 2026-06-28

### Fixed
- Settings > General "Clear captures" now removes all captured runtime files instead of only volatile logs, so the capture count actually drops to zero; it reports a clear error (and refreshes the count) if a file is still locked by a running game.
- Runtime captures whose folder is created at runtime (e.g. `red4ext/plugins/Codeware/Persistent`, `r6/storages/RedscriptConfigFramework`, `bin/x64/plugins/address_library`) now restore correctly on launch — the captured file's full missing parent-directory chain is materialized virtually before the read overlay link, eliminating the recurring "Some VFS links failed" warning and the silent loss of those captured settings between sessions. A final dedup pass before mounting also collapses any duplicate links from every builder so identical links can no longer be reported as failures.
- Library separator expanded/collapsed state now survives view changes and auto-install rescans, so completed Nexus downloads no longer reopen separators the user left closed.
- Conflict detail archive counts now group by unique resource identity, matching the `+N` / `-N` library badges while still indicating when multiple mods share the same resource.
- Archive-resource conflicts with no resolvable path now display as archive hashes instead of noisy "unresolved" rows, and `.archive` conflicts no longer leak into the regular Files subtab.
- Archive hash resolution now discovers `.kark` databases inside the configured library instead of relying on hard-coded mod folder names, while keeping startup hash-list loading limited to known direct paths so the splash screen is not held by broad library scans.
- Startup no longer waits for the full conflict refresh before showing the main window; conflict badges and details continue updating in the background after the library opens.
- Conflict refresh now applies a fast indexed pass before the deep `.archive` hash pass, so badges and conflict rows remain visible while resource paths are being resolved.
- Conflict detail tables now list every opposing mod row instead of compacting extras behind `+N`.
- Nexus auto-install now opens the duplicate mod decision dialog before extraction for already-installed mods instead of silently choosing replace for same-version downloads.
- Move to Separator now moves selected mods without revealing the destination separator, so the library viewport does not jump away from the user's current scroll position.
- Selecting a single conflicted mod now shows floating related-mod rows at the top or bottom of the library when conflict partners are off-screen or hidden inside collapsed separators, without resizing the main mod rows.
- Floating related-mod rows now jump to the referenced mod instead of opening details, with shorter status labels that do not truncate into unreadable text.
- Clicking a floating conflict row Go button now scrolls and highlights the target mod correctly instead of silently dismissing the rows; the mousedown on the button no longer cleared the selection before the click could fire.
- Hyperion internal sidecars such as `_archive_resources.json` are excluded from file metadata, deployment paths, and conflict detection so deleting a file in the Files tab no longer creates fake `+1` / `-1` conflicts across the library.
- New Nexus installs now prefer the Nexus mod page name for the library display name, and scans preserve saved names instead of renormalizing them from archive-style text.
- Reinstall and replace flows now preserve the target mod's existing load-order position, including FOMOD and conflict retry paths.
- Conflict badges refresh immediately after reinstall/update activation so a replaced mod keeps showing its `+N` / `-N` state without waiting for a later library refresh.
- Rename inputs now save on blur, ignore unchanged names, and allow the native Cut/Copy/Paste/Select All context menu inside the text field.

---

## [0.28.0] - 2026-06-27

### Changed
- `Move to Separator` destinations now use compact centered clickable rows with subtle arrows and stronger hover/focus states.
- Removed the redundant `Create Separator at End` item from the empty-library context menu; `Create Separator Here` is now the single separator creation action there.

---

## [0.27.3] - 2026-06-27

### Changed
- Settings now uses cleaner categorized decision rows with underline tabs, fewer bordered boxes, and a stricter left/right alignment grid.
- App Logs now shares the same underline tab rail visual language as Settings.
- Settings About links now use clearer filled secondary button surfaces so outbound actions read as clickable controls.

---

## [0.27.2] - 2026-06-27

### Changed
- Managed Mods status filtering now uses a compact `All / On / Off` readout with a clearable `Viewing enabled/disabled` notice instead of a dropdown trigger.
- The Hyperion self-update CTA in the header now uses the same borderless filled/tinted button language as the Library toolbar.

---

## [0.27.1] - 2026-06-27

---

## [0.27.0] - 2026-06-27

---

## [0.26.0] - 2026-06-27

### Added
- Library conflict badges now show `+N` for unique resources a mod overwrites, `-N` for unique resources overwritten by later-loading mods, and a yellow `!` marker when the mod is fully redundant.
- Conflict badge tooltips now separate overwrite, overwritten-by, and redundant states into compact color-coded rows for faster scanning.

### Changed
- Conflict detection now counts unique resource ownership by load order and emits pairwise conflict relationships for every lower/higher owner on the same resource. A middle duplicate can now correctly show both the mods it overwrites and the mods that overwrite it, and selected-row highlighting shows both directions.
- Fully redundant mods are detected only when every tracked deploy/archive resource is overwritten by later load-order owners.
- The Library, Downloads, Settings, sidebar account block, progress rows, action buttons, badges, and status readouts now use cleaner filled/tinted surfaces instead of heavy colored outline boxes.
- Settings tabs now attach visually to the active content panel, and Runtime Captures moved from Settings > Paths to Settings > General beside Install Behavior.
- The Managed Mods status filter trigger now keeps a fixed width and fixed icon/label/chevron positions so selecting All/Enabled/Disabled no longer shifts adjacent toolbar buttons.

### Fixed
- Toolbar icons now preserve readable color on hover instead of disappearing or changing independently from their labels.
- The Library status filter focus state no longer leaves small yellow artifacts on the trigger corners.

---

## [0.25.0] - 2026-06-26

### Added
- Manual mod installs now recover their Nexus identity from a bundled `meta.ini` (reading `modid`/`fileid`/`version`) when there is no Hyperion download record. Mods downloaded via Nexus "manual download" that ship a `meta.ini` get the "Open on Nexus" action and version info, the same as mods installed through the in-app Nexus pipeline. Reinstall an existing mod to pick this up.
- Nexus identity lookup by file hash on install: when an archive has no download record and no `meta.ini`, Hyperion hashes the source archive (MD5) and queries the Nexus `md5_search` API to identify which mod/file it came from, filling in the Nexus mod id, file id, version, and category. Requires a Nexus API key (Settings > Nexus); it's best-effort and skipped silently when no key is set or the archive isn't recognized.

### Changed
- Nexus update checking no longer does a full per-mod pass automatically. Update indicators are persisted across sessions and shown instantly from cache. On launch the app does a single lightweight bulk check (one request that finds what changed since the last check, plus a detailed look only at those few mods) — not one request per installed mod. Beyond launch, refreshing is user-driven: the new per-mod **Check for Update** right-click action, or the **Check Updates** toolbar button. Install/reinstall/delete no longer trigger update checks. This keeps a 2,000-mod library from spending thousands of requests on launch.
- The **Check Updates** button now uses an efficient bulk check instead of one request per mod: a single `updated.json` call (with a window that adapts to how long since the last check — 1 day / 1 week / 1 month) finds which mods changed, and only those get a detailed check. Checking a 2,000-mod library now costs roughly one request plus the few that actually changed, instead of 2,000 requests.
- Added a **Check for Update** action to the mod right-click menu (Nexus-sourced mods only), which checks that single mod and toasts the result.
- The persisted update cache (statuses + last-check time) now lives in the app's data folder instead of renderer storage, so it survives restarts reliably and the "what changed since last check" window stays accurate across sessions.
- The Downloads view now refreshes itself automatically when archives are added to or removed from the configured Downloads folder externally (e.g. a manual Nexus download dropped in). The main process watches the folder and the list updates without pressing refresh; the watcher re-points when the Downloads path is changed in Settings.

---

## [0.24.3] - 2026-06-25

### Fixed
- Reinstalling a mod now always looks up the original archive by name inside the currently configured Downloads folder first, falling back to the absolute source path stored at install time only when the archive is not present there. Moving the Downloads folder to a new location in Settings no longer breaks reinstall with "Original source is no longer available".
- The reinstall source is now validated before the Reinstall dialog opens: if the archive isn't found, a short toast explains it instead of letting the user click Replace only to hit an error.

---

## [0.24.2] - 2026-06-25

### Fixed
- The installer finish page now hides immediately after clicking Finish with "Run Hyperion" checked and launches Hyperion directly, so Windows/Electron startup no longer leaves the installer looking frozen.

---

## [0.24.1] - 2026-06-25

### Fixed
- "Use suggested" now creates the suggested Mod Library or Downloads folder immediately after loading that path, so install-dir defaults such as `Hyperion\Mods` and `Hyperion\Downloads` exist before saving.

---

## [0.24.0] - 2026-06-25

### Changed
- The suggested Mod Library and Downloads locations now live inside the Hyperion install directory (a `Mods` and `Downloads` folder beside the app) for a self-contained, portable layout. "Use suggested" reflects this. Existing installs keep their saved paths

### Fixed
- The uninstaller (used by both manual uninstall and auto-update) now removes only Hyperion's own files instead of recursively deleting the entire install directory. Previously, an update or uninstall wiped everything inside the install folder — including the Mod Library, Downloads, and any unrelated folder the user had placed there. The uninstaller now deletes exactly its packed footprint (recorded at build time) and removes the install directory only if it is empty, so user data and any other content alongside the app are preserved. Note: this protects updates/uninstalls from this version onward; the first update from an older build still runs that build's destructive uninstaller, so back up first if your mods currently live inside a pre-fix install folder

---

## [0.23.1] - 2026-06-25

### Changed
- The Downloads toolbar's "Delete All" button is now right-aligned at the far end of the row, lining up with the Actions column's per-row delete icon, instead of sitting next to "Open Folder"

---

## [0.23.0] - 2026-06-25

### Fixed
- "Use suggested" in Settings > Paths now only sets its own folder — clicking it on the Mod Library card no longer also overwrites the Downloads path (and vice versa). The same independence was applied to the first-run onboarding wizard: the Downloads step's suggestion and preview no longer derive from the current library path

---

## [0.22.3] - 2026-06-25

### Changed
- `release:patch|minor|major` now folds the version bump + changelog roll into the last local commit (single commit per release) instead of adding a separate `chore(release)` commit. It only amends when the commit hasn't been pushed yet; otherwise it falls back to a fresh commit so public history is never rewritten

---

## [0.22.2] - 2026-06-25

### Fixed
- "Create Separator Before" on a mod or separator now inserts the new separator at the correct position — previously it could land below the containing separator instead of before the right-clicked row

---

## [0.22.1] - 2026-06-25

### Fixed
- Auto-install now scans the library and enables the mod after install, so it immediately appears in Managed Mods as active without a manual Refresh Library

---

## [0.22.0] - 2026-06-25

### Added
- First-run onboarding now has a fourth step, `Nexus`, that walks the user through getting their personal Nexus Mods API key (open the API Key page, copy the Personal API Key, paste it), with a masked input + reveal toggle and live validation showing the connected account and tier. The step is optional and `Finish setup` saves the key. The welcome wizard is now `Game → Mod library → Downloads → Nexus`
- Right-clicking an editable field (e.g. the Nexus API key input) or selected text now shows a native Cut/Copy/Paste/Select All menu

---

## [0.21.2] - 2026-06-25

### Fixed
- Renaming a mod in the library now renames its on-disk folder to match the new name (previously only the display name changed). Existing mods are unaffected until renamed; the folder name is a sanitized form of the display name (invalid filesystem characters stripped)

---

## [0.21.1] - 2026-06-25

### Fixed
- Installed mod folders now keep spaces in their on-disk folder name instead of replacing them with underscores (e.g. `LUT Switcher - Nova LUT Pack` instead of `LUT_Switcher_-_Nova_LUT_Pack`), matching how separators already name their folders. Only invalid filesystem characters are stripped. Existing mods installed with underscore folders keep working unchanged
- Release script (`prepare-release-tag.mjs`) no longer crashes after committing when git output is inherited, so `release:*` completes the tag + push in one run

---

## [0.21.0] - 2026-06-25

### Added
- Library table columns are now resizable, cascade-style: `#`, `Version`, `Category`, and `Date` each have a right-border drag handle, and dragging one shifts the columns to its right along. Shrinking leaves space on the right; growing scrolls horizontally. The `Mod Name` and `Actions` columns stay static. Resizing is content-aware: a column won't drag narrower than its widest visible text (e.g. "VISUALS AND GRAPHICS" or a full timestamp), so it stops at the limit instead of truncating, and cells clip so a narrowed column can't overlap the next one. `Mod Name` auto-fills the viewport on first run; the layout persists across sessions

- "Move to Separator" in the right-click context menu and bulk selection bar now opens a centered modal with a search field that filters separators by name as you type. The context menu shows a single "Move to Separator" entry instead of an inline list, and both entry points share the same dialog. The modal is wider for long separator names and keeps a comfortable minimum height for many separators
- Completed Nexus downloads now auto-install by default. A new `General` tab in Settings ("Install Behavior") toggles this; with it off, archives stay staged in Downloads. The flow still pauses for duplicate, FOMOD, version, or overwrite decisions
- Library search now matches a mod's category in addition to its name and author
- Dragging a mod near the top or bottom edge of the list now auto-scrolls so rows can be reordered across long lists without dropping and re-grabbing

### Changed
- Library `Category` column now resolves and shows the real Nexus category name (e.g. "Modders Resources", "Visuals and Graphics") instead of only the detected type. The Nexus category id is resolved to its name against the game's category list and stored in mod metadata on the next update check. Sorting by `Category` and the Mod Card chip use the same resolved label
- Library `Category` column renders as plain left-aligned uppercase text (neutral color) instead of a cramped bordered badge chip
- Mods grouped under a separator are no longer indented — they align flush with ungrouped rows; the cyan left accent and separator header still convey grouping. Install/delete progress rows also drop the nested indent
- Library context menus are reorganized into function groups with a consistent color language: cyan for separator/organization actions (`Create Separator Before`, `Move to Separator`, `Move to Top Level`), yellow for generic mod actions, and red for `Delete`. The mod row menu now leads with `Details`/`Rename`/`Reinstall` and moves `Refresh Library` to a utility group at the bottom
- Inline separator rename now uses a full-width input that spans to the end of the row
- Library toolbar's `Add Separator` button is replaced by `Open Mods Folder`; separator creation lives in context menus and custom-order workflows
- Installer extraction temp directories now live in the OS temp folder (`temp/Hyperion/installer`) instead of inside the mod library, and are cleaned up automatically on launch and quit — including legacy `_tmp_*` folders left in the library by older builds

### Removed
- Per-separator `Expand Separator` / `Collapse Separator` context-menu actions (clicking the separator row already toggles it); `Expand All` / `Collapse All` remain
- `Move Selected Here` from the separator context menu — moving a selection now goes through the shared `Move to Separator` modal

### Fixed
- Settings now opens on the General tab by default instead of Paths, making Install Behavior visible immediately on open
- Nexus-sourced mods now use the clean Nexus file display name (e.g. "Weird Glass Begone") for the library name instead of inheriting author tokens/hashes baked into the archive filename (e.g. "Weird Glass Begone 1 sHIUHDmOO")
- Nexus duplicate-download prompt no longer fires for files that only exist in a previous downloads folder; the duplicate check is now scoped to the currently configured downloads directory
- FOMOD installer preview panel now scrolls long plugin descriptions instead of pushing the preview image out of view, with a stable scrollbar gutter so content doesn't shift
- FOMOD installer now clears a stale prompt when its config fails to load, instead of leaving an empty wizard open
- Toolbar button icons now track the label color in every state (e.g. turn black on the yellow hover) instead of staying yellow-on-yellow
- Sort header labels truncate cleanly when a column is narrowed, keeping the sort arrow aligned

---

## [0.20.1] - 2026-06-24

### Changed
- Release workflow now fetches the usvfs SDK (`npm run fetch:usvfs`) before building, so the native bridge compiles in CI
- Release workflow pinned to the `windows-2022` runner — node-gyp 10.x cannot detect the Visual Studio 18 on the newer `windows-latest` image, which broke the native usvfs-bridge compile
- `npm run release:patch|minor|major` is now fully automated: it bumps the version, rolls the CHANGELOG `[Unreleased]` section into a dated heading, commits, tags, and pushes (pass `--no-push` to stop before pushing)

---

## [0.20.0] - 2026-06-24

### Added
- Settings > Paths now has a Runtime Captures card to open or clear files written by mod tools (CET, RED4ext) during gameplay; removed from Library toolbar

### Changed
- Conflict inspector (mod detail Conflicts tab) redesigned to a clean MO2-style layout: two flat `File | Mod` tables — "This Mod Wins" on top (files this mod loads over) and "Other Mods Win" below (files that load over this mod). Rows are single-line and clustered by the opposing mod (load-order priority), with zebra striping so the eye tracks a file across to its mod. The mod column is wide and wraps so long mod names always show in full (no truncation); the column header sticks while scrolling and stays aligned with the rows. Section icons use the visibility metaphor (eye = your file loads, eye-off = your file is hidden). The internal resource hash is hidden unless a resource path is unresolved. Removed the unused standalone ConflictInspectorDialog
- Install overlay redesigned: unified into a single compact card (Analyzing/Extracting/Installing), no verbose description text, mod name in DM Sans instead of brand-font uppercase
- Install overlay no longer appears on Downloads view while a download row is active — modal overlay handles progress exclusively and the row no longer shows its own install fill bar simultaneously
- VFS launch progress dialog removed — Launch Game button spinner is the only indicator during VFS mount; errors surface as toasts; Close Game waits 1.5s after taskkill before running residue migration so file handles are released
- `checkConflicts` now returns resolved archive resources alongside conflicts, eliminating the second `resolveArchiveResources` call during install (halves conflict-check time for large archives like ArchiveXL)
- FOMOD installer micro-labels bumped to minimum 11–12px across all group headers, step counter, Preview label, and Required badge
- Page titles (Managed Mods, Downloads, Settings) switched from brand-font (Syne) to Oxanium to distinguish them visually from the Hyperion wordmark
- Nexus download filename now falls back to the `file_name` field from the Nexus files API when the CDN URL path has no archive extension (fixes UUID-named downloads with no installable format)
- `npm run build` now builds the local NSIS installer; `npm run publish` publishes to GitHub; CI workflow updated accordingly

### Removed
- usvfs-bridge development test harnesses (`test/vfs-*.test.js`) removed from the repository
- usvfs-bridge README phases table and open-risks dev notes replaced with clean production documentation

---

## [0.19.0] - 2026-06-23

### Changed
- Mod deployment now uses NTFS file symlinks instead of file copies, enabling cross-drive mod libraries without duplicating data
- Archive resource hashes moved from `_metadata.json` into a separate `_archive_resources.json` sidecar per mod, keeping metadata files lean; existing installations are migrated automatically on first scan
- Conflict detection now correctly excludes disabled mods — disabled mod files are not deployed and must not appear in conflict lists
- Packaged app now requests Administrator elevation via UAC (`requestedExecutionLevel: requireAdministrator`) so symlink creation works without requiring Windows Developer Mode
- `npm run build` now produces the local NSIS installer; `npm run publish` publishes to GitHub

### Removed
- Removed hardlink, junction, and file-copy deployment code from `fileUtils.ts`

---

## [0.18.2] - 2026-06-22

### Added
- Settings > Nexus > Account now shows a side-by-side Free vs Premium comparison explaining how each tier behaves inside Hyperion (mod updates, download links, install flow)
- Temporary DEV toggle in the Library toolbar to simulate Free account behavior for testing the nxm:// update flow

## [0.18.1] - 2026-06-22

### Changed
- The Hyperion self-update check now runs in the main process during the splash, so the header update button is ready the moment the window opens instead of a few seconds after the renderer boots

---

## [0.18.0] - 2026-06-22

### Added
- Version mismatch prompt now offers an **Add to Library** option in every case, installing the selected archive as a separate copy so both versions can coexist
- Close (X) button on the version mismatch dialog for a clean dismissal without changing anything

### Changed
- Steam launch now spawns the exe directly while injecting `SteamAppId`/`SteamGameId` env vars and writing `steam_appid.txt` next to the executable, so Steam tracks the session (overlay, playtime, achievements) like Vortex does
- Launch Game button shows a **LAUNCHING...** spinner state until the game process is detected
- Version mismatch dialog redesigned to be more compact and intuitive: a single `installed → selected` version row, uniform options across upgrade/downgrade, and the recommended action as the dominant card with the secondary action in the footer

### Fixed
- Mod update detection is now scoped to the installed file's own Nexus `file_updates` lineage (with same-name fallback), so an installed OPTIONAL file is no longer falsely flagged as updatable to an unrelated MAIN file on the same mod page
- Conflict warning icon no longer appears on disabled mods, since a disabled mod deploys nothing and cannot participate in conflicts

---

## [0.17.0] - 2026-06-20

### Added
- Game running detection: Hyperion polls every 5 seconds via `tasklist` to check whether Cyberpunk 2077 is running
- Sidebar **IN GAME** state — the Launch Game button switches to a restrained success-green style and becomes non-clickable while the game is active
- Sidebar **CLOSE GAME** button — appears below Launch Game when the game is running; force-kills the process via `taskkill /F`
- Mod installation is now blocked while the game is running, with a descriptive toast warning
- `CHANGELOG.md` introduced to track changes per release

### Fixed
- Game launch now uses a detached `child_process.spawn` instead of `shell.openPath`, so the process is properly tracked by Steam (overlay, playtime, achievements)

---

## [0.16.0] - 2026-06-20

### Added
- Startup and manual **Check Updates** now run a full per-mod Nexus file pass so every installed Nexus mod gets a reliable update status without missing older available versions
- Version comparison falls back to numeric semver when Nexus file metadata is incomplete or ambiguous (e.g. ArchiveXL `1.26.2` vs `1.26.8`)
- Summarized Nexus `files.json` request logs (count + small sample) instead of storing and rendering the full payload

### Changed
- Library-initiated mod updates stay on the Library view, download through the existing NXM pipeline, replace the source mod automatically, and re-enable it — no navigation to Downloads
- Inline mod updates do not leave a persistent `NEW` marker in Downloads
- Conflict inspector layout refinements: Loss section on top, Win on bottom; sections with zero entries auto-collapse on open; archive-resource rows show hash and archive pair inline without a nested card

---

## [0.15.0] - 2026-06-15

### Changed
- Welcome screen now includes a close control
- Setup wizard icon buttons have corrected baseline alignment and centered labels
- Settings and setup surfaces received visual polish (spacing, border rhythm, typography)

---

## [0.14.0] - 2026-04-28

### Added
- **FOMOD Installer** — when a mod archive contains `fomod/ModuleConfig.xml`, a multi-step configuration wizard opens instead of installing automatically
- FOMOD XML parsing via browser-native `DOMParser` (`fomodParser.ts`) with support for `SelectExactlyOne`, `SelectAtMostOne`, `SelectAny`, and `SelectAll` group types
- Optional module image banner and per-plugin preview images in the FOMOD dialog
- `Required` and `NotUsable` plugin states with appropriate visual treatment
- FOMOD cancel flow cleans up the temporary extraction directory
- Conflict retry and duplicate flows integrated into the FOMOD pipeline
- `IPC.FOMOD_READ_IMAGE` for loading local preview images without CSP restrictions
- `hashes.csv.gz` (~29 MB compressed) bundled with the installer — covers ~1.7 million FNV1a hashes for archive-resource conflict detection including EP1/Phantom Liberty

---

## [0.13.0] - 2026-04-25

### Added
- **Archive-resource conflict detection** — mods sharing the same internal RED4 archive hash are flagged as `archive-resource` conflicts in addition to file-path `overwrite` conflicts
- Hash resolution via `archiveParser.ts` (reads archive headers) and `hashResolver.ts` (cross-references the bundled hash database)
- Conflict icons on mod rows replaced dual `+N / −N` numeric badges with a single semantic `warning` icon: green (wins only), red (loses only), yellow (mixed)
- Archive pair details shown inline inside the conflict inspector (hash, this archive, other archive)

### Fixed
- Archive magic constant corrected (`RDAR` → `RED4`); archive header bounds checks tightened
- Conflict state recompute now includes archive-resource conflicts alongside overwrite conflicts
- Mod detail modal widened to `min(1480px, calc(100vw - 24px))` so long mod names in the Other Mod column are no longer truncated
- Archive-resource badge color inherits section tone (green/red) instead of always rendering red

---

## [0.12.0] - 2026-04-24

### Added
- Mod details opens as a centered modal overlay with two tabs: **Files** (dense game-relative file tree) and **Details** (metadata, notes, conflicts, source context, actions)
- Conflict inspector inside the mod detail modal with win/loss sections
- **Overwrite conflict dialog** — when installing a mod that shares game-target paths with an enabled mod, the user is shown a preview and asked to confirm or cancel
- `Downloads`, `DetailPanel`, and `ModList` responsibilities extracted into focused components and hooks

### Changed
- Library UI refactor: shared Hyperion UI primitives introduced; library store helpers and conflict refresh logic split into dedicated files
- Toggle all mods enable/disable now processes in bulk via a single IPC call instead of sequential per-mod calls — significantly faster on large libraries
- Double-clicking a mod row opens the mod detail modal

### Fixed
- Installer error typing tightened; TypeScript config updated

---

## [0.9.0] - 2026-04-20

### Added
- Mod conflict inspection and overwrite workflow: conflict state is stored in the Zustand store and recomputed on every install/uninstall/enable/disable
- **Settings redesign** — three-tab layout (Paths, Nexus, Updates) replacing the previous single-panel design
- Nexus account identity in the sidebar: avatar with initials, subscription badge (Premium amber / Free blue), connection state
- `useNexusAccount` hook with automatic API key validation and debouncing

### Changed
- Install flows refined: improved Nexus download routing, duplicate handling, install confirmation flows
- Version mismatch dialogs polished; install locking and delete progress feedback improved
- Separator organization, context actions, and library/downloads interactions expanded

---

## [0.8.1] - 2026-04-20

### Fixed
- Minor fixes following 0.8.0 release

---

## [0.8.0] - 2026-04-20

### Added
- Persistent `NEW` badges on Nexus downloads; clicking the archive row acknowledges and clears the marker
- Version-aware install prompts for staged Nexus archives
- Mod type detection and deployment for `engine`, `r6`, and redscript-style archives

### Changed
- Nexus download staging restored with manual download-to-install flow
- Duplicate download handling, pause/resume stability, and download ordering improved
- Dialogs, welcome layout, app version visibility, and shell sizing aligned with design rules

---

## [0.7.0] - 2026-04-19

### Added
- Active Nexus downloads rendered inline in the Downloads table with live progress, pause/resume controls, and `NEW` badge on completion
- Sidebar Downloads badge shows active transfer count while downloading, falls back to `NEW` marker when unacknowledged downloads remain

### Fixed
- Duplicate NXM download prevention and double-row visual overlap resolved
- Install freeze fixed: extraction now runs asynchronously via 7zip subprocess with per-file progress events
- `modDir` ReferenceError in installer catch block
- Downloads column alignment, format colors, size text, and NXM protocol handling corrected
- Splash taking too long and window appearing minimized at startup
- Mod re-enable deferred to background so splash closes faster

---

## [0.6.1] - 2026-04-17

### Fixed
- Bulk delete UX and reinstall targeting corrected
- Settings scrollbar gutter stabilized

---

## [0.6.0] - 2026-04-17

### Changed
- Setup and renderer performance refinements
- Mod library toolbar and header controls redesigned

---

## [0.5.10] - 2026-04-17

### Fixed
- Text contrast raised to WCAG AA-safe levels across the UI

---

## [0.5.9] - 2026-04-17

### Fixed
- Semver version string corrected in package metadata

---

## [0.5.8.1] - 2026-04-17

### Fixed
- Windows installer now installs for the current user only; removed all-users/current-user selection screen

---

## [0.5.5] - 2026-04-17

### Changed
- Auto-updater flow streamlined to a single-step experience: one header button starts download, shows inline progress, then installs and relaunches silently

---

## [0.5.3] - 2026-04-17

### Fixed
- Updater download state finalized correctly after silent install

---

## [0.5.2] - 2026-04-17

### Changed
- Branding and updater header refined

---

## [0.5.1] - 2026-04-17

### Fixed
- Installer publishing to GitHub Releases corrected

---

## [0.5.0] - 2026-04-17

### Added
- **Nexus Mods integration** — NXM protocol handler (`nxm://` links), API key validation, CDN URL resolution, and streaming file downloader
- Downloads pane with active download rows, local file list, and install/reinstall actions
- Single-instance lock with pending NXM URL delivery on `APP_READY`
- GitHub Actions release workflow (`release.yml`) for automated artifact publishing via electron-builder
- Auto-updater: checks GitHub releases, downloads in the header button, installs and relaunches silently
