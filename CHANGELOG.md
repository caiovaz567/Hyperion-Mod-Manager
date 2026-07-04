# Changelog

All notable changes to Hyperion are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [0.33.1] - 2026-07-04

### Fixed
- **The Nexus API key can no longer be silently erased.** Opening Settings could race the form's hydration and auto-save an empty key over the stored one. The key field now only saves after a real user edit, settings saves are merged field-by-field over what is on disk (so no screen can overwrite values it didn't touch), and App Logs records a warning whenever a stored key is cleared.
- The first-run "Use suggested" folders always point beside the Hyperion installation (`Mods`/`Downloads` next to the executable) - never a Documents/OneDrive fallback, and the downloads suggestion is no longer derived from the library location.

---

## [0.33.0] - 2026-07-04

### Added
- **Automated test suite guarding the destructive paths.** 82 unit tests (vitest, run by `npm test` and on every push via GitHub Actions) now pin down the logic that decides where files are written and deleted: deploy-path computation (including flat and nested REDmod layouts and path-traversal stripping), mod-type detection, the deleted-mod capture sweep (proving it can never touch another mod's data or shared framework folders), FOMOD parsing (including malformed XML), conflict math (unique-resource counts, redundant detection, pairwise expansion), nxm-link / Nexus update-lineage resolution, the install naming pipeline (folder sanitization, collision suffixes, game-root preservation, `meta.ini` identity recovery), the `.archive` binary parser against corrupt/truncated/hostile files (returns null, never crashes), the Nexus download registry (upsert/lookup/dead-record pruning), and the VFS mount plan (`buildEnabledModLinks` - load-order-respecting mounts, load-ordered virtual archive names, single materialization of virtual folders).
- **End-to-end smoke test** (`npm run test:e2e`): launches the real app via Playwright inside an isolated throwaway profile (own settings, fake game folder, fixture archives - the machine's real setup is never touched) and exercises the core journey: first-run welcome, installing two conflicting archives from the Downloads screen, the +1/-1 conflict badges, search filtering, disabling a mod dissolving the conflict pair, and deleting a mod through the confirm dialog with the folder really leaving the disk. Screenshots every step and fails on any renderer crash - the pre-release safety net. The App Logs header button and the Downloads row install/delete buttons also gained proper accessible names (`aria-label`).

### Changed
- **Hyperion has a real visual identity.** A new brand icon (white H on the canonical blue rounded square) replaces the legacy yellow mark across the executable, installer, shortcuts, taskbar and window - crisp at every size from 16px up, and immune to Windows' icon cache (the window icon is served from memory). The in-app brand follows: header, splash and the setup screen draw the same white H on an accent-colored plate (so it recolors live with your chosen accent), the header shows just the mark and reveals the HYPERION wordmark on hover, and the splash is now nothing but the oversized mark floating with a soft pulsing accent glow. The README carries the new logo, and the executable metadata now includes the author/copyright.
- The Downloads search field gained the same one-click clear (X) as the library search.
- **Library columns are now fixed - column resizing was removed.** Version, Category and Date have set widths sized to their content and Mod Name flexes to fill the rest, so the table always fits the window: no more permanent horizontal scrollbar hiding the right-hand columns on smaller screens. The drag handles and the persisted per-user column widths are gone (stale settings entries are ignored).

### Fixed
- **The Nexus API key can no longer be lost by mixing dev and installed builds.** `npm run dev` and the installed app shared the same data folder: the installed build stores the key encrypted with a machine key dev cannot read, and a dev settings save then dropped the encrypted copy - each side kept destroying the other's key. Dev now uses its own `Hyperion-Dev` data folder (seeded once from the existing settings).
- The launch success card now says "Running with N active mods" instead of exposing a process PID.
- **The REDmod compile console is no longer an empty black window.** The compiler window now shows redMod's real output live (compile warnings, files written, stage progress) - and the launch status card narrates the same lines inside the app, so you can follow the deploy from either place.
- **Interface text reads comfortably at every resolution - and stays pixel-crisp.** Two fixes: the resolution-based UI zoom used to shrink everything fully proportionally below its 1440p baseline (13px interface text rendered at ~9px physical on a 1920x1080 monitor - unreadable); downscaling now runs at half strength with a floor (1080p ≈ 86% instead of 72%). And the base type scale itself was proportionally small, so every reading size across the app grew by 1px (12→13, 13→14, 14/`text-sm`→15) - real font sizes, not an optical zoom, so text stays sharp instead of blurring at fractional zoom factors.
- **Mods shipping a full game tree with deeply nested payloads are typed correctly again.** Type detection stopped scanning 6 folder levels down, so a CET mod packaged as `bin/x64/plugins/cyber_engine_tweaks/mods/<mod>/init.lua` (7 levels) was misdetected as `unknown`. The scan now reaches those payloads.

---

## [0.32.0] - 2026-07-03

### Changed
- **Hyperion's interface was rebuilt on the HeroUI component library for a cleaner, more modern look.** Buttons, switches, inputs, chips/badges, dialogs, context menus, tooltips and toasts are now real HeroUI components (rounded surfaces, borderless fills, the Inter typeface) instead of hand-styled boxes, and the old Material UI dependency was removed entirely (a smaller app bundle as a result). The default highlight color is now a blue accent, and **Settings > General gains a "Color" picker** - a row of swatches (blue, cyan, green, yellow, orange, red, pink, purple) that recolors every button, switch, tab and highlight across the app instantly (including the first-run setup screen) and persists across sessions. All dialogs and right-click menus follow the selected color consistently, with semantic red reserved for destructive actions, and **every icon in the app is now a clean Lucide line-icon** - the Material Symbols icon font was removed entirely. Downloads status is color-coded (installed = green, downloaded = blue), buttons show the pointer cursor, and the decorative accent bars on top of dialogs were dropped.
- **One tab pattern everywhere**: Settings, App Logs and the mod-details modal share the same underline tab rail (sentence-case label with an accent underline on a divider line), and sub-tabs inside a section (the conflict inspector's Paths / .archive split) use a compact segmented pill control so two underline rails never stack.
- **Settings was reorganized into single-column cards**: each setting is one card with an icon tile, title and description up top and its control beside the title (a real HeroUI switch for auto-install) - no more side-by-side explanation column. The About tab was cleaned up: version/license/unofficial are proper info chips (never button-like), the project/support/credits content reads top-to-bottom, and outbound links are clearly salient accent-tinted buttons.
- **The sidebar was tidied**: the account avatar, nav icons and Settings gear now sit on one exact vertical axis, nav icons are slightly larger, the first item is labeled "Mods" (with a proper stacked-boxes icon instead of an empty square), the avatar follows the chosen accent color, and the account tier chip is a real HeroUI chip - Premium keeps its gold, Free follows the accent color.
- **The language selector moved to the app header** (a compact translate-icon button beside App Logs, opening a "Choose a language" popover in the HeroUI style) and was removed from Settings > General; the setup wizard uses the same icon button. The setup/welcome flow itself was restyled to the HeroUI look (surface cards, Inter headings, accent icon tiles).
- **The splash screen was redesigned to match the HeroUI look**: a flat rounded dark card with the brand mark and progress bar tinted in the user's chosen accent color (no more fixed-yellow glow effects).
- Close buttons across dialogs use the HeroUI CloseButton, header window controls share the same icon-button chrome as the language/App Logs buttons, toolbar buttons and search fields share one 40px height, tooltips use readable Inter sentence-case copy, remaining thin white inset borders were removed in favor of background-shift hover feedback, and scrollbars are now neutral gray instead of accent-tinted.
- **Drop shadows were removed from every floating surface** - modals (mod details, delete/confirm dialogs, FOMOD installer, App Logs), context menus, popovers, toasts, tooltips, the bulk-selection bar and the install overlay now separate from the page through their border and the dimmed backdrop alone, in both light and dark modes.
- **Switching between light and dark now cross-fades smoothly** - the whole frame fades on the GPU (View Transitions API) instead of hard-flipping in one frame, so it stays fluid no matter how much is on screen; the header's light/dark/system toggle also matches the height of the buttons beside it.
- **The sidebar Launch Game states joined the HeroUI look**: Launching / In Game / Close Game / disabled are now borderless tinted fills (accent, green, red, neutral) with sentence-weight text - no more dark outline boxes with washed uppercase labels - and the off-state switch track is clearly visible in dark mode too.
- **The FOMOD installer joined the HeroUI look**: accent icon tile + sentence-case mod name in the header (with a close button, previously missing), the step progress became a rounded track beside the step counter instead of a bare line on the modal's top edge, group/preview labels dropped the tiny uppercase microtype, option cards are borderless surfaces with proper hover states, and "required"/"all selected" are real HeroUI chips. The header self-update button, the drag-to-top-level header state, the separator drop-target row, and the separator "N mods" count (now a real chip that no longer melts into the bar) followed suit - all mode-aware, no more fixed dark fills in light mode.
- **Jumping to a conflicting mod now flashes the target row.** Clicking `GO` in the conflict overlay already scrolled to and selected the mod, but the arrival cue was a barely-visible 1px ring - it's now an unmistakable accent-colored background flash that fades out, in both color modes. The overlay rows themselves were also made readable in light mode (their text used fixed dark-mode colors), and the stray yellow hairline that could appear under a selected conflicting mod on hover (a leftover of the old yellow accent) now follows the accent color.
- **The whole renderer is now token-driven - the final light-mode sweep.** Roughly 80 remaining hardcoded dark-mode colors (row/cell grays, dialog text, progress rows, validation copy, status readouts) were mapped to the theme tokens, and the pale status-text pastels (mint/rose/amber/blue used on tinted fills) became mode-aware tokens with dark readable shades in light mode. Only the fixed-meaning status hues, per-type colors and dark-text-on-colored-fill hover pairs remain literal - by design.
- **A batch of light-mode legibility fixes**: clicking a text field no longer draws the boxy focus outline (fields keep their background-shift feedback; the keyboard focus ring stays for buttons/controls), text selection follows the accent color instead of the legacy yellow, the Settings > Nexus tier-comparison cards use dark readable amber/blue in light mode, switches that are off get a visibly darker track, the sidebar Mods icon uses a lighter-weight glyph so it no longer reads darker than its neighbors, and App Logs got a real light-mode pass - method/level/status tags are proper HeroUI chips and the payload inspector is an always-dark code surface so its syntax colors stay readable in both modes.

### Added
- **Launching the game now shows what's happening.** The launch pipeline (scanning mods, mounting the virtual file system, compiling REDmods, starting the game) always reported progress internally, but the UI never showed it - the sidebar just spun on "Launching...", which read as frozen during the multi-minute first REDmod compile. A floating status card now narrates each step with a progress bar, supports cancelling the preparation steps, auto-dismisses on success, and keeps errors visible with details.
- **REDmods now actually work.** Installing a REDmod used to look fine but silently do nothing in game - the required compile step never ran. At launch, when enabled mods include REDmod content, Hyperion now runs the official `redMod.exe deploy` **inside the virtual file system**: the tool sees the virtual `mods/` folder, its compiled output is captured into Runtime Captures instead of dirtying the game folder, and the game is started with `-modded` so the mods load. The slow compile is skipped on later launches when the enabled REDmod set hasn't changed, deploy progress shows in the launch overlay (and can be cancelled), and if the REDmod DLC isn't installed the launch continues normally with a warning instead of failing. **REDmod load order follows your library order** - the mod lower in the list wins conflicts, exactly like the rest of Hyperion's priority system (with an automatic fallback to REDmod's default order if the tool rejects the list).
- **Light mode.** A new light / dark / system toggle lives in the header (following the OS scheme live when set to system, the default). Light mode mirrors HeroUI's light scheme - light-gray canvas with white elevated cards - and works with every accent color; the splash screen follows the same mode and accent.

### Removed
- **The JSON theme system** (Dark/Clean theme selector, the Themes folder, and community-theme support) was removed before ever shipping - visual customization is now the single accent-color picker, which covers the same need with far less complexity.

### Performance
- **The app opens faster - fonts no longer come from the internet.** Every cold start used to fetch Inter/Syne/Oxanium/JetBrains Mono from Google Fonts with text hidden until they arrived, and the boot sequence waited up to 1.8s for them (including two fonts that were removed from the project long ago and could never load). All fonts are now bundled inside the app, so they load from disk in milliseconds, the boot no longer waits on the network, and Hyperion starts identically offline.
- **The renderer no longer holds every mod's full file list in memory.** Library scans used to ship each mod's complete file array (and archive-resource index) over IPC and keep them resident in the UI store - tens of MB with a 2,000-mod library, re-serialized on every scan. Bulk scan results now cross the IPC boundary slimmed to what the UI actually renders, plus a precomputed tracked-resource count that keeps the "fully redundant" conflict math exact; the mod-details Files tab still gets the real file list from its dedicated on-open refresh. The conflict pass also caches each mod's derived deploy paths, so recomputing conflicts on an unchanged library reuses them instead of re-deriving ~1M paths.
- **Large libraries got dramatically cheaper to scan.** Every library scan (boot, install, delete, enable/disable) used to re-read and re-parse every mod's `_metadata.json` AND archive sidecar from disk - with 2,000 mods that's ~4,000 file reads per scan, several times per action. Mod metadata is now cached in memory and validated by each file's on-disk identity (mtime + size), so a scan of an unchanged library costs two cheap stat calls per mod; external edits still surface naturally. Locating a mod's folder by id (enable/disable/rename) also uses a direct hint instead of walking the whole library.
- **The Nexus download registry no longer re-reads itself per lookup.** Every registry lookup used to re-read the registry JSON from disk and existence-check every record - and the Downloads refresh performs one lookup per archive, so a large folder turned one refresh into millions of file-system calls. The registry now lives in memory with an O(1) path index; dead records are swept at natural write points instead of on every read. The Downloads list cap was also raised from 500 to 10,000 archives.
- **Scrolling Downloads with 120+ archives is smooth again.** Above that size the list windows its rows, but the scroll position that drives the windowing lived in the whole Downloads screen - so every scroll frame re-rendered the entire screen (toolbar, dialogs, sort pipeline and all rows), which read as ~30fps. The scroll state now lives in a small dedicated row-list component (the same isolation the mod library uses), rows are memoized so a scroll frame only renders the rows entering the viewport, and the scroll container gets its own composited layer.

### Fixed
- **Closing Hyperion while Cyberpunk is running no longer pulls the mods out from under the game.** Quitting used to tear the virtual file system down unconditionally, making every mod file vanish mid-session for a game that was still running (and moving runtime files while the game was still writing them). Hyperion now detects that the game is still attached and leaves the virtual layer alive; the cleanup happens safely on the next start instead.
- **Loader files staged into the game folder can no longer be orphaned by a crash.** The few physical bootstrap files Hyperion stages for early-init frameworks (e.g. CET's `version.dll`) were tracked only in memory - if Hyperion crashed or was killed while the game ran, they stayed in the game folder forever, even after disabling the mods. Staging is now recorded in a small manifest on disk, and a sweep on the next startup (or the next launch) removes exactly what a previous session left behind.
- **Launching the game twice in quick succession can no longer reset the virtual file system under a game that just started.** A second Launch click (the "in game" state takes a few seconds to appear) now gets a clear "already running" response instead of remounting.
- **The end-of-game detection is more tolerant of transient hiccups**: it now requires two consecutive "game gone" checks (8 s) before unmounting, so a momentary process-listing failure can't tear the mods away from a game that is still running.
- Background process checks (`tasklist`/`taskkill`) now run with hidden windows, preventing brief console flashes in the packaged app.

### Security
- **The Nexus API key is now stored encrypted in installed builds.** It used to sit in plain text inside `settings.json`; installed builds now encrypt it with the operating system's credential protection (DPAPI on Windows) and existing plaintext keys migrate automatically on the next start. If the settings file is copied to another machine or user account the key simply won't decrypt - re-enter it in Settings > Nexus. (In `npm run dev` the key is kept in plain text because the dev session's encryption key is intentionally throwaway per run; encryption applies to the packaged app only.)
- **The account API key no longer travels into App Logs at all.** Request logs used to carry the full key internally (masked in the UI, but revealable); now only a masked form ever reaches the log store, so neither the reveal toggle nor copy can expose it - including the `key` field that the Nexus validate response echoes back in its response body, which was previously logged raw. The short-lived per-download token keeps its reveal for debugging - it expires in minutes and is useless without the account key.
- **Nexus API requests now refuse to follow redirects**, so the authentication header can never be handed to a different host, and CDN downloads cap redirect chains instead of following them forever.
- **Rate limiting is handled gracefully**: hitting the Nexus API limit now produces a clear "rate limit reached, retry in Xs" message instead of a raw error body, and each request log entry records the remaining hourly/daily quota so exhaustion is diagnosable from App Logs.

---

## [0.31.0] - 2026-07-01

- **The WolvenKit resource-hash database parses ~2x faster and no longer sits in RAM when it isn't needed.** Conflict detection cross-references a bundled ~30 MB / 1.7-million-row hash database. Its parse was rewritten to read the already-normalized CSV directly instead of re-running per-row normalization on all 1.7M rows (verified byte-for-byte identical output), cutting it from ~1.5s to ~0.8s, and it yields between chunks so it never freezes the app while loading. It also loads strictly on demand again (on the first install/re-index or when a mod's conflict names are resolved) rather than eagerly at startup - because conflict detection now treats an already-indexed mod as final, the launch path never needs the database, so an idle session no longer holds a few hundred MB for a lookup table it won't use.

### Changed
- **The splash screen now shows real, moving progress instead of freezing on a single label.** The root cause was a bug: the helper that updates the splash text ran `const s = …` at the top of an injected script, and because every injection shares the splash page's top-level scope, the *second* update onward threw "Identifier 's' has already been declared" - silently swallowed - so the splash only ever displayed its very first line ("Loading settings…", and every later step was dropped). That's fixed (the script is now function-scoped), and on top of it the boot sequence reports what's actually happening, live: "Starting Hyperion…" during main-process startup, then real per-mod counters as it works ("Scanning library · 45/105", "Checking conflicts · 45/105") and labelled steps in between. The mod scan and conflict pass yield to the splash mid-work (only during boot) so the counter actually advances on screen rather than jumping at the end, and every progress update also doubles as a "still alive" heartbeat for the boot safety net.
- **Deleting a mod now removes the runtime files it left behind.** When mods run, tools like CET and RED4ext write per-mod settings/configs into the game folder, which Hyperion captures into the Runtime Captures (Overwrite) folder so they survive between sessions. Those captures used to linger forever even after the owning mod was deleted, slowly piling up (hundreds of files from mods you no longer have). Deleting a mod now also removes its leftover captures. The Runtime Captures folder otherwise stays a single, always-active catch-all - captures are **never** moved, parked, or hidden based on enable/disable state, so nothing a mod generates is ever relocated behind your back. The cleanup is deliberately conservative: it only deletes files inside the deleted mod's own private folder (its CET-mod or RED4ext-plugin subfolder), never files at the root of a shared framework folder (e.g. `cyber_engine_tweaks/`) or anything used by other mods. Use the **Clear captures** button in Settings to wipe the folder manually whenever you want.
- **Files added or removed directly inside a mod's folder now show up.** For speed, Hyperion reuses each mod's stored file list on routine scans and never re-walks the folder - so dropping a folder (e.g. `bin/`) into a mod via Explorer didn't appear in that mod's Files tab. Now opening a mod's details re-reads its files from disk, and a new recursive watcher on the mod library refreshes the view live when files change externally (mirroring the existing Downloads-folder watcher). The watcher ignores Hyperion's own metadata/sidecar writes so refreshing never loops.
- **Installing a mod no longer hangs on "checking conflicts" while it resolves archive resource names.** Conflict detection only needs each `.archive` resource's hash, but the installer was also eagerly resolving those hashes into readable resource paths for the inspector - which means spawning PowerShell to read per-archive LXRS tables and external `.kark` databases. That display-only work, on the critical path of every install and index pass, is what made installs sit on "checking conflicts" for a long time. Name resolution is now split out: indexing/install resolves names from the in-memory hash database only (instant, no PowerShell), and the slow external tooling runs lazily, on demand, only when you actually open a mod's conflict inspector and it still has unresolved hashes (cached afterwards, at most once per mod per session). Conflicts are detected by hash, so nothing about conflict accuracy changes - resources whose names aren't in the database simply show their raw hash until you view them, then resolve in place.

### Performance
- **The app window opens noticeably faster on a large library.** The splash used to sit on "Ready" for a moment before the window appeared because the library rendered *every* mod row at once (100+ rich rows = thousands of DOM nodes) before revealing. The list now windows itself - rendering only the visible rows plus a small buffer - so the first paint touches ~30–50 rows instead of all of them. Crucially, the scroll-position state that drives windowing was moved out of the big `ModList` and into the small row-list component, so scrolling re-renders only that row list (never the whole library view). That removes the per-scroll-frame cost that previously made windowing not worth enabling for normal libraries, so scrolling stays smooth even with windowing on.
- **Creating, renaming, or deleting an item in a mod's Files tab is now instant instead of taking a moment.** Each of those actions re-read **every file of every installed mod** from disk before returning (and a second time, plus a redeploy, for enabled mods), then the renderer re-scanned the whole library and recomputed all conflicts before closing the dialog - so on a large library a simple "new folder" stalled noticeably. Now only the edited mod is refreshed from disk (the deployment is virtual and needs no resync), the renderer updates just that one mod so the tree repaints immediately, and the full library/conflict sync runs in the background without blocking the action.
- **Scrolling/dragging the scrollbar in a large library no longer stutters.** Three compounding causes: (1) the mod rows skip painting when off-screen via `content-visibility`, but their reserved placeholder height was `54px` while rows are actually `38px` - so every row visibly resized as it scrolled into view, shifting everything below it and making the scrollbar jump each frame (worst when dragging the thumb). The placeholder now matches the real height. (2) The virtualization helper tracked scroll position in React state even when virtualization was off (it is below ~120 mods), forcing a re-render of the whole list on every scroll frame; it now only does so when actually windowing rows. (3) The floating "jump to conflicting mod" overlay needed the scroll position, which dragged the whole list's re-render along with it; it now tracks the scroll container itself, so only that small overlay updates while scrolling. None of this was related to how many conflicts exist.

### Fixed
- **The splash no longer logs a false "Renderer did not signal APP_READY in time" warning on a slow (but healthy) start.** The safety net that guarantees the window reveals even if boot hangs was an absolute 12-second deadline from first paint - but a large library can legitimately boot for longer than that while progressing fine (scanning 100+ mods, first-run conflict re-index), so it fired the warning and revealed early even though nothing was stuck. It is now an inactivity watchdog: every boot-status update ("Loading settings…", "Scanning mod library…", "Checking mod conflicts…") re-arms the timer, so it only triggers after the renderer goes genuinely silent for the whole grace period - the real "stuck on the splash" hang it was meant to catch.
- **Fixed an infinite re-render loop that froze the app (especially while a mod with conflicts was selected).** The recursive mod-library watcher emitted `LIBRARY_CHANGED` whenever files changed; the renderer reacted by re-scanning with a file-metadata refresh, which rewrites each mod's `_metadata.json` / `_archive_resources.json`. The watcher's name filter skipped those files, but writing a file inside a mod folder also fires a *directory-level* event (the folder's own mtime) whose filename is the folder - which slipped past the filter and re-triggered the scan, looping forever (the library re-scanned and recomputed conflicts thousands of times per second). Hyperion's own writes now open a brief self-write suppression window that the watcher respects, so a refresh can no longer trigger itself; genuine external edits still surface. Also made the conflict-highlight store action idempotent (it no longer creates a new object when nothing changed) to remove a second way the same situation could spin.
- **The app no longer gets stuck forever on the splash ("LOADING SETTINGS…").** The window was only revealed once the renderer finished booting and sent its "ready" signal; if that boot stalled on a slow or hung IPC the signal never came and the splash stayed up indefinitely. A safety net now reveals the window a few seconds after it can first paint, regardless of the renderer's boot state, so a stalled boot can no longer trap you on the splash.
- **Conflict badges no longer take many seconds to appear on the first conflict check of each session.** The biggest cause of the "wait a while for the icon" problem was that a mod already indexed at the current sidecar version was still being re-resolved on every launch and every conflict refresh if it had any *unresolved* archive hashes. A single popular mod can contribute thousands of such hashes (e.g. Appearance Menu Mod ≈ 2.7k), and re-resolving them spawned a `resolve-kark-hashes` PowerShell process per 250 hashes per `.kark` file found on disk - easily ~24 PowerShell launches against CET's TweakDB `.kark` files, which can't resolve resource hashes anyway. That ran once per session (then cached in memory, which is why the *second* reinstall felt instant) and blocked the first conflict pass / the first reinstall's "checking conflicts" for many seconds. An already-indexed sidecar is now treated as final and skipped entirely - the expensive resolution still runs once at install time (and after a sidecar-format bump), but never again on routine launches/refreshes. Conflicts are detected by hash, not by resolved path, so badges are unaffected; the only difference is that genuinely unresolvable resources keep showing as "Unresolved" in the inspector (as they already did). This is the root-cause fix behind the slow-icon reports.
- **Conflict badges are present the moment the window opens, instead of popping in a second or two after launch.** The startup conflict pass had been changed to fire-and-forget (`void`), so the main window revealed before the badges were computed and the `+N`/`-N`/`!` icons appeared a moment later - a regression against 0.28.0, which waited for the conflict pass before showing the window. Startup now waits for the conflict pass again, but only for its cheap first phase: the conflict refresh resolves its awaitable as soon as the badges are on screen (computed from already-indexed sidecars), and the slow deep phase - which can parse `.archive` files and run external hash tooling - continues to refine in the background after the window is shown. Previously awaiting the whole thing could freeze the splash on a large library or a first-run re-index. A safety cap (6s) lets boot proceed regardless, so a pathologically slow scan can never trap the splash. (Reinstalling a mod already keeps it in its original list position here - that part of 0.28.0's behavior was the one thing it got wrong, and it's correct now.)
- **Conflict badges no longer disappear after reinstalling a mod.** Reinstalling (Replace) refreshes the library by re-scanning from disk, but the `+N`/`-N`/`!` conflict badges are renderer-computed state that the on-disk metadata doesn't carry - so the re-scan blanked every badge until the asynchronous conflict refresh landed. On the first reinstall after launch that refresh is queued behind the slow first-run deep archive-hash pass, so the badges stayed gone "for a while" (and only reappeared after clicking around long enough for that pass to finish); subsequent reinstalls looked fine because the hash cache was warm. The re-scan now carries each mod's existing conflict summary over by uuid (reinstall/replace preserves the uuid), so badges stay stable through the reinstall and the scheduled refresh simply corrects them when it runs.

---

## [0.30.2] - 2026-06-29

### Changed
- **Launch no longer re-checks Nexus for mod updates if it already did so within the last hour.** The cached update indicators are shown instantly on every launch regardless; previously the app also fired a fresh `updated.json` request on *every* launch, so rapid relaunches each hit Nexus needlessly. A recency gate now reuses the still-fresh cache for quick relaunches, while a normal session gap (closed earlier, reopened later) still gets a fresh check. The manual "Check Updates" button and per-mod checks are unaffected - they always run. Additionally, a launch check that's skipped for a missing API key no longer advances the cache timestamp, so adding a key later isn't suppressed by the gate.

### Fixed
- **The mouse no longer flickers to the "no-drop" block cursor while dragging mods/separators in the library.** Allowing a drop requires cancelling **both** `dragenter` and `dragover`; only `dragover` was being cancelled. `dragenter` fires every time the cursor crosses into a new element - and a row is full of small ones (cells, icons, text) - so the block cursor flashed on every micro-movement before `dragover` restored the move cursor, producing a constant flicker. While an internal drag is active, a single document-level listener now cancels both events for the whole window, giving a steady "move" cursor for the duration of the drag.
- **Dragging a separator now shows a single, concise section-boundary indicator instead of a flickering bar.** When you drag a separator over another section, the cyan bar snaps to a whole-section boundary and flips exactly once, at the section's mid-point: while the cursor is in the top half of the section the bar sits above the section header (the separator will land before it); once past the mid-point it jumps to below the section's last mod (the separator will land after the entire block). Previously the bar teleported between the header and the group's far edge every time the cursor crossed any row's midpoint, making it flash rapidly up and down. The indicator and the actual drop result are now always the same, and the decision respects collapsed/filtered sections (it uses the visible mods you actually see).
- **Dragging a separator onto a mod inside another separator no longer nests it there.** Separators cannot live inside other separators, so a dragged separator always lands at a whole-section boundary (before the header or after the entire block) rather than splitting the group or stealing its mods.
- **Selecting text in the separator name dialog no longer closes it.** Clicking and dragging inside the name input to select text could land the mouse release on the backdrop overlay, triggering the close handler. The backdrop now only closes the dialog when both the press and the release happened on the backdrop itself - not when a drag originated inside the input. Same fix applied to the Move to Separator search dialog.
- **Moving a separator below another separator no longer steals its mods.** Dragging an empty separator (e.g., "Teste") and dropping it below another separator (e.g., "CHAR APPEARANCE") with 20 mods used to splice "Teste" between CHAR APPEARANCE's header and its mods, making all 20 mods appear to belong to "Teste". The drag-and-drop now correctly inserts after the target separator's last child mod, keeping each separator's mod group intact. The drop indicator line is also now shown at the correct position (after the last child).
- **The interface now scales uniformly to your monitor's resolution.** Previously the window grew/shrank with the display but the UI itself stayed at fixed pixel sizes, so 1080p screens got a cramped layout with truncated table columns (`Down…`) while 4K screens got a tiny, sparse UI. Hyperion now applies a single resolution-proportional zoom (relative to a 1440p baseline) so 1080p, 1440p, and 4K all render the same logical layout - just physically larger or smaller. It accounts for OS display scaling and re-applies when the window moves to another monitor or the display configuration changes.

---

## [0.30.1] - 2026-06-29

### Changed
- Nexus requests now send a descriptive, fully dynamic `User-Agent` (`Hyperion/{version} ({OS} {release}; {arch}) Electron/{version}`) instead of the minimal `Hyperion-{version}` string, matching the format recommended for Nexus API clients. Every field is derived at runtime, so a `package.json` version bump is all that's needed - no manual edits.

### Fixed
- The Nexus CDN file download now sends the same `User-Agent` header as the API calls. Previously the actual archive download went out with a blank `User-Agent`, which the Nexus API Acceptable Use Policy discourages.

---

## [0.30.0] - 2026-06-29

### Added
- **Interface language selector (internationalization).** Hyperion can now be displayed in multiple languages. A language dropdown appears in two places: the first-run setup wizard (top-right of the welcome/onboarding screen) and **Settings > General**. The choice persists across sessions in app settings (`language`) and applies live without a restart. The **entire interface is now translatable** - app shell, Downloads, Library (mod details, conflicts, and all dialogs), every Settings tab, the FOMOD installer, the shared install/conflict/version dialogs, App Logs, and toasts all read from the translation catalog; only main-process error strings remain English. English is the source of truth (`en.json`); a **complete Brazilian Portuguese (Português Brasil)** catalog now ships at full key parity (712/712), and any untranslated string still falls back to English so the app always stays readable. New languages can be added by dropping a JSON catalog into `src/renderer/i18n/locales/` and registering it in `locales.ts` - no other code changes required.

### Fixed
- Several previously-hardcoded English strings are now translatable: all Library action toasts (install/delete/rename/move/enable/disable, drag-and-drop, separator actions), the Downloads delete-row status badge, the FOMOD installer's fallback module/step/group/plugin names, and the path validation "no folder selected" label.

### Removed
- Deleted four unused legacy components that were no longer rendered anywhere (`StatusBar`, `ModCard`, `LibraryPathSnackbar`, `ViewBackButton`) and the now-orphaned `statusMessage`/`setStatus` store state they depended on.

---

## [0.29.2] - 2026-06-28

### Added
- Collapsed separators now show a cyber-blue `upgrade N` badge when any child mod has an update available, so pending updates are visible without expanding every group.

### Fixed
- First-run setup can no longer be skipped silently. The welcome wizard now stays visible until the user explicitly clicks **Finish setup** (tracked by a new persisted `setupCompleted` flag), instead of disappearing the moment the game and library paths happen to validate. Previously, if a user ran "Detect automatically" before Cyberpunk 2077 was installed, the auto-detected game path was saved during boot and - once the game was later installed - the next launch went straight to the library, bypassing the wizard. Existing installs with a configured game path are treated as already onboarded, so they are not pushed back through setup.

---

## [0.29.1] - 2026-06-28

### Fixed
- `npm install` on Node 24 no longer fails to extract the Electron binary - added `overrides` for `yauzl@^3.0.0` (forces the `extract-zip` postinstall to use yauzl 3.x, which handles the Node 24 stream API correctly) and `cacache`→`glob@^13.0.0` (eliminates the deprecated glob@10 warning from node-gyp).
- Upgraded `electron-builder` to `^26` and `electron-updater` to `^6.8.9` to remove transitive deprecated packages (`tar@6`, `glob@7`/`@10`, `inflight`, `rimraf@2`).
- Bumped `node-gyp` to `^11` so native builds use `tar@7` and the modern `tinyglobby` resolver instead of the deprecated `glob@7`.

---

## [0.29.0] - 2026-06-28

### Fixed
- Settings > General "Clear captures" now removes all captured runtime files instead of only volatile logs, so the capture count actually drops to zero; it reports a clear error (and refreshes the count) if a file is still locked by a running game.
- Runtime captures whose folder is created at runtime (e.g. `red4ext/plugins/Codeware/Persistent`, `r6/storages/RedscriptConfigFramework`, `bin/x64/plugins/address_library`) now restore correctly on launch - the captured file's full missing parent-directory chain is materialized virtually before the read overlay link, eliminating the recurring "Some VFS links failed" warning and the silent loss of those captured settings between sessions. A final dedup pass before mounting also collapses any duplicate links from every builder so identical links can no longer be reported as failures.
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
- Nexus update checking no longer does a full per-mod pass automatically. Update indicators are persisted across sessions and shown instantly from cache. On launch the app does a single lightweight bulk check (one request that finds what changed since the last check, plus a detailed look only at those few mods) - not one request per installed mod. Beyond launch, refreshing is user-driven: the new per-mod **Check for Update** right-click action, or the **Check Updates** toolbar button. Install/reinstall/delete no longer trigger update checks. This keeps a 2,000-mod library from spending thousands of requests on launch.
- The **Check Updates** button now uses an efficient bulk check instead of one request per mod: a single `updated.json` call (with a window that adapts to how long since the last check - 1 day / 1 week / 1 month) finds which mods changed, and only those get a detailed check. Checking a 2,000-mod library now costs roughly one request plus the few that actually changed, instead of 2,000 requests.
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
- The uninstaller (used by both manual uninstall and auto-update) now removes only Hyperion's own files instead of recursively deleting the entire install directory. Previously, an update or uninstall wiped everything inside the install folder - including the Mod Library, Downloads, and any unrelated folder the user had placed there. The uninstaller now deletes exactly its packed footprint (recorded at build time) and removes the install directory only if it is empty, so user data and any other content alongside the app are preserved. Note: this protects updates/uninstalls from this version onward; the first update from an older build still runs that build's destructive uninstaller, so back up first if your mods currently live inside a pre-fix install folder

---

## [0.23.1] - 2026-06-25

### Changed
- The Downloads toolbar's "Delete All" button is now right-aligned at the far end of the row, lining up with the Actions column's per-row delete icon, instead of sitting next to "Open Folder"

---

## [0.23.0] - 2026-06-25

### Fixed
- "Use suggested" in Settings > Paths now only sets its own folder - clicking it on the Mod Library card no longer also overwrites the Downloads path (and vice versa). The same independence was applied to the first-run onboarding wizard: the Downloads step's suggestion and preview no longer derive from the current library path

---

## [0.22.3] - 2026-06-25

### Changed
- `release:patch|minor|major` now folds the version bump + changelog roll into the last local commit (single commit per release) instead of adding a separate `chore(release)` commit. It only amends when the commit hasn't been pushed yet; otherwise it falls back to a fresh commit so public history is never rewritten

---

## [0.22.2] - 2026-06-25

### Fixed
- "Create Separator Before" on a mod or separator now inserts the new separator at the correct position - previously it could land below the containing separator instead of before the right-clicked row

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
- Mods grouped under a separator are no longer indented - they align flush with ungrouped rows; the cyan left accent and separator header still convey grouping. Install/delete progress rows also drop the nested indent
- Library context menus are reorganized into function groups with a consistent color language: cyan for separator/organization actions (`Create Separator Before`, `Move to Separator`, `Move to Top Level`), yellow for generic mod actions, and red for `Delete`. The mod row menu now leads with `Details`/`Rename`/`Reinstall` and moves `Refresh Library` to a utility group at the bottom
- Inline separator rename now uses a full-width input that spans to the end of the row
- Library toolbar's `Add Separator` button is replaced by `Open Mods Folder`; separator creation lives in context menus and custom-order workflows
- Installer extraction temp directories now live in the OS temp folder (`temp/Hyperion/installer`) instead of inside the mod library, and are cleaned up automatically on launch and quit - including legacy `_tmp_*` folders left in the library by older builds

### Removed
- Per-separator `Expand Separator` / `Collapse Separator` context-menu actions (clicking the separator row already toggles it); `Expand All` / `Collapse All` remain
- `Move Selected Here` from the separator context menu - moving a selection now goes through the shared `Move to Separator` modal

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
- Release workflow pinned to the `windows-2022` runner - node-gyp 10.x cannot detect the Visual Studio 18 on the newer `windows-latest` image, which broke the native usvfs-bridge compile
- `npm run release:patch|minor|major` is now fully automated: it bumps the version, rolls the CHANGELOG `[Unreleased]` section into a dated heading, commits, tags, and pushes (pass `--no-push` to stop before pushing)

---

## [0.20.0] - 2026-06-24

### Added
- Settings > Paths now has a Runtime Captures card to open or clear files written by mod tools (CET, RED4ext) during gameplay; removed from Library toolbar

### Changed
- Conflict inspector (mod detail Conflicts tab) redesigned to a clean MO2-style layout: two flat `File | Mod` tables - "This Mod Wins" on top (files this mod loads over) and "Other Mods Win" below (files that load over this mod). Rows are single-line and clustered by the opposing mod (load-order priority), with zebra striping so the eye tracks a file across to its mod. The mod column is wide and wraps so long mod names always show in full (no truncation); the column header sticks while scrolling and stays aligned with the rows. Section icons use the visibility metaphor (eye = your file loads, eye-off = your file is hidden). The internal resource hash is hidden unless a resource path is unresolved. Removed the unused standalone ConflictInspectorDialog
- Install overlay redesigned: unified into a single compact card (Analyzing/Extracting/Installing), no verbose description text, mod name in DM Sans instead of brand-font uppercase
- Install overlay no longer appears on Downloads view while a download row is active - modal overlay handles progress exclusively and the row no longer shows its own install fill bar simultaneously
- VFS launch progress dialog removed - Launch Game button spinner is the only indicator during VFS mount; errors surface as toasts; Close Game waits 1.5s after taskkill before running residue migration so file handles are released
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
- Conflict detection now correctly excludes disabled mods - disabled mod files are not deployed and must not appear in conflict lists
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
- Sidebar **IN GAME** state - the Launch Game button switches to a restrained success-green style and becomes non-clickable while the game is active
- Sidebar **CLOSE GAME** button - appears below Launch Game when the game is running; force-kills the process via `taskkill /F`
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
- Library-initiated mod updates stay on the Library view, download through the existing NXM pipeline, replace the source mod automatically, and re-enable it - no navigation to Downloads
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
- **FOMOD Installer** - when a mod archive contains `fomod/ModuleConfig.xml`, a multi-step configuration wizard opens instead of installing automatically
- FOMOD XML parsing via browser-native `DOMParser` (`fomodParser.ts`) with support for `SelectExactlyOne`, `SelectAtMostOne`, `SelectAny`, and `SelectAll` group types
- Optional module image banner and per-plugin preview images in the FOMOD dialog
- `Required` and `NotUsable` plugin states with appropriate visual treatment
- FOMOD cancel flow cleans up the temporary extraction directory
- Conflict retry and duplicate flows integrated into the FOMOD pipeline
- `IPC.FOMOD_READ_IMAGE` for loading local preview images without CSP restrictions
- `hashes.csv.gz` (~29 MB compressed) bundled with the installer - covers ~1.7 million FNV1a hashes for archive-resource conflict detection including EP1/Phantom Liberty

---

## [0.13.0] - 2026-04-25

### Added
- **Archive-resource conflict detection** - mods sharing the same internal RED4 archive hash are flagged as `archive-resource` conflicts in addition to file-path `overwrite` conflicts
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
- **Overwrite conflict dialog** - when installing a mod that shares game-target paths with an enabled mod, the user is shown a preview and asked to confirm or cancel
- `Downloads`, `DetailPanel`, and `ModList` responsibilities extracted into focused components and hooks

### Changed
- Library UI refactor: shared Hyperion UI primitives introduced; library store helpers and conflict refresh logic split into dedicated files
- Toggle all mods enable/disable now processes in bulk via a single IPC call instead of sequential per-mod calls - significantly faster on large libraries
- Double-clicking a mod row opens the mod detail modal

### Fixed
- Installer error typing tightened; TypeScript config updated

---

## [0.9.0] - 2026-04-20

### Added
- Mod conflict inspection and overwrite workflow: conflict state is stored in the Zustand store and recomputed on every install/uninstall/enable/disable
- **Settings redesign** - three-tab layout (Paths, Nexus, Updates) replacing the previous single-panel design
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
- **Nexus Mods integration** - NXM protocol handler (`nxm://` links), API key validation, CDN URL resolution, and streaming file downloader
- Downloads pane with active download rows, local file list, and install/reinstall actions
- Single-instance lock with pending NXM URL delivery on `APP_READY`
- GitHub Actions release workflow (`release.yml`) for automated artifact publishing via electron-builder
- Auto-updater: checks GitHub releases, downloads in the header button, installs and relaunches silently
