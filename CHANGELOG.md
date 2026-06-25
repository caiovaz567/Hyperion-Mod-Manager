# Changelog

All notable changes to Hyperion are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
