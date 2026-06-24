# Changelog

All notable changes to Hyperion are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
