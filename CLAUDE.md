# Hyperion Project Guide

## Purpose
- Hyperion is an Electron + React desktop mod manager for Cyberpunk 2077.
- Primary user flows: first-run setup, library management, download inspection, install/reinstall, launch game, self-update.
- Keep the app feeling sharp, restrained, and production-oriented. Avoid novelty UI that fights readability.

## Source Of Truth
@DESIGN.md
- If the code and DESIGN.md disagree, update the code and then update DESIGN.md in the same task.
- For larger visual explorations, use Google Stitch first to prototype screen direction, then implement the chosen direction in code.

## Stack
- Electron main process in src/main.
- React renderer in src/renderer.
- Shared IPC contracts in src/shared/types.ts.
- State management uses Zustand slices under src/renderer/store/slices.
- Styling is Tailwind utility-first with project tokens in src/renderer/styles/globals.css.

## Architecture Notes
- Main window stays hidden until the renderer sends IPC.APP_READY.
- Splash is handled by the main process. Do not add a second renderer splash.
- Native Cut/Copy/Paste/Select All on editable fields and selected text is wired in the main process via `attachEditContextMenu` (the `webContents.on('context-menu')` handler in `createMainWindow`, `index.ts`) — Electron shows no edit menu by default. It returns early for non-editable, non-selection targets so renderer-side custom menus (library rows, etc.) are unaffected. Do not add a duplicate renderer-side copy/paste menu.
- Settings, mod scan, path validation, install/reinstall, and updater all flow through IPC.
- Mod library scan must ignore symlinks (they are deployment artifacts, not source files).
- Installed mod metadata stores sourcePath/sourceType so reinstalls can reuse the original source.
- Mod folder names preserve spaces and hyphens — `sanitizeFolderName` only strips filesystem-invalid characters (`<>:"/\|?*`), it does NOT replace spaces with underscores. Mods are keyed by `uuid`/`folderName` (synced to the real on-disk folder during scan), so older mods installed with `_`-style folders and newer space-style folders coexist with no migration. Do not reintroduce underscore folder names or batch-rename existing folders.
- Renaming a mod or separator (`IPC.UPDATE_MOD_METADATA` in `modManager.ts`) renames its on-disk folder to match the new display name and updates `folderName`. Mods use `getUniqueModFolderName`, separators use `getUniqueSeparatorFolderName` (both sanitize + de-duplicate with a numeric suffix). Deployment is virtual, so renaming the source folder is safe — the VFS recomputes links from `folderName` on the next launch.
- Installer extraction temp dirs live in `app.getPath('temp')/Hyperion/installer` (created via `createInstallerTempDir`/`removeInstallerTempDir` in `installer.ts`), NOT inside the mod library. `cleanupInstallerTempDirs(settings)` runs on app launch and `before-quit` to remove orphans, and also sweeps legacy `_tmp_*`/`_tmp_fomod_*` folders that older builds left in the library. Never recreate temp dirs inside `libraryPath`.

## Deployment System (Virtual / usvfs VFS)
- Deployment is **virtual by default**: enabled mods are mapped over the game tree by **usvfs** (the MO2 User-Space Virtual File System) at Launch Game, so there are no symlinks, no full copies, no admin/UAC, and it works cross-drive. This replaced the old NTFS-symlink deployment.
- Bootstrap exception: import-time proxy/loaders must be visible before the process starts. `IPC.LAUNCH_GAME` physically stages only path-based bootstrap candidates (top-level `bin/x64` DLL/ASI/INI/config files and direct `bin/x64/plugins` DLL/ASI/INI/config files) before mounting usvfs; all remaining mod payload stays virtual. CET's `version.dll` + ASI loader is just one example of this rule.
- Native bridge lives in `native/usvfs-bridge/` (see its README) and is loaded via `src/main/vfsBridge.ts` (`loadVfsBridge()`/`isVfsAvailable()`). Built with `npm run build:native`, bundled to `process.resourcesPath/usvfs` for packaged builds. usvfs binaries are fetched by `npm run fetch:usvfs` (pinned v0.5.7.2, gitignored under `vendor/`).
- `buildEnabledModLinks(gamePath, libraryPath)` in `modManager.ts` computes the ordered `{source, dest}` pairs from enabled mods (load order = ascending priority, later overrides earlier). `IPC.LAUNCH_GAME` in `index.ts` calls `mountVfs(links)` → `launchHookedProcess(Cyberpunk2077.exe)` and unmounts on game exit / kill / quit.
- `redeployEnabledMods` is now a **no-op** that just refreshes library state — enable/disable/install/reorder only update `_metadata.json`; the VFS reflects them on the next launch. The old `deployedPaths` field is vestigial (no longer written).
- The `createSymlink`/`safeRemoveLink`/`isLink` primitives still exist in `fileUtils.ts` but are no longer used for deployment (kept for a possible one-time cleanup of legacy symlinks left in the game folder by older elevated runs).
- Runs as `asInvoker` (no UAC elevation). usvfs does not require admin — it uses user-space API hooking. This also allows `nxm://` protocol forwarding to work correctly (a non-elevated browser can hand links to a non-elevated app).
- Conflict detection only considers **enabled** mods — both in `modManager.ts` and `modConflictState.ts` (renderer). It reads game-target paths via `getTrackedDeploymentPaths`, which computes them from each mod's files (no longer relies on on-disk deployment).

## Runtime Captures
- When mods run under usvfs, tools like CET write files physically into the game directory (keybindings, logs, generated configs). On game exit these are migrated out of the game folder into a **Runtime Captures** folder that lives beside the Mod Library (e.g. `Documents/Hyperion/Overwrite`), so the game directory stays clean between sessions.
- `migrateVfsPhysicalResidue` in `src/main/index.ts` handles migration: `collectVfsResidueDirs` identifies directories that may have runtime writes (plugin dirs, red4ext/logs), then `migratePhysicalResidueDir` processes each file — removing it if it matches the mod's source file exactly, or moving it to Runtime Captures if it was modified at runtime.
- `cleanVfsOverwriteVolatileFiles` removes log files from Runtime Captures after migration (logs are regenerated on every launch and don't need to persist).
- On the next launch, Runtime Captures files are mounted back as VFS read overlays via `buildVfsOverwriteReadLinks`, so CET keybindings and other settings persist across sessions.
- **Close Game timing**: `IPC.KILL_GAME` waits 1.5 s after `taskkill` before running residue migration — `taskkill` completes the command before the OS fully releases file handles, so an immediate migration races against locks.
- Exposed in **Settings > General** as a "Runtime Captures" card with file count plus "Open folder" and "Clear captures" actions. It does not belong in Settings > Paths because it is automatic runtime output rather than a user-chosen path. Intentionally absent from the Library toolbar — the system is fully automatic.

## Archive Resource Sidecar
- For mods containing `.archive` files, resource hashes are stored in a separate `_archive_resources.json` sidecar alongside `_metadata.json` — not inside the metadata file itself.
- Sidecar format: `{ "version": 3, "resources": [{ "hash", "resourcePath", "archivePath" }] }`.
- `readArchiveSidecar` / `writeArchiveSidecar` in `modManager.ts` handle reads and writes. `ARCHIVE_RESOURCE_INDEX_VERSION` (currently 3) is exported so `installer.ts` can write sidecars on first install.
- **Migration**: `readMetadata` auto-migrates existing `_metadata.json` files that still contain `archiveResources`/`hashes` fields — writes the sidecar, strips those fields from the JSON, no manual action needed.
- `writeMetadata` always strips archive fields before writing so they never re-enter `_metadata.json`.
- Non-archive mods that previously had a sidecar get it deleted during `refreshArchiveResourceMetadata`.

## FOMOD Installer

- FOMOD is a mod configuration format (XML-based) used widely on Nexus Mods to offer conditional install options (body type, hair color, etc.).
- Detection: after extraction in `src/main/ipc/installer.ts`, the main `installMod` function checks for `fomod/ModuleConfig.xml` at the `extractRoot`. If found, it returns `status: 'fomod'` with the XML string and `tempDir`/`extractRoot` paths. The `tempDir` is intentionally kept alive for the FOMOD flow.
- XML parsing is done in the renderer via `src/renderer/utils/fomodParser.ts` using the browser-native `DOMParser`. Key exports: `parseFomodXml`, `buildInitialSelections`, `resolveInstallEntries`, `fomodImageUrl`.
- The wizard UI is `src/renderer/features/ui/FomodInstallerDialog.tsx` — a multi-step modal rendered via `createPortal` in App.tsx.
- When the user confirms Install, the renderer calls `IPC.FOMOD_INSTALL` (`install:fomod`) with a `FomodInstallRequest` containing the resolved `installEntries`. The main process copies selected files into a staging dir, runs conflict/type detection, then commits to the library.
- On Cancel, the renderer calls `IPC.FOMOD_CANCEL` (`install:fomodCancel`) to clean up `tempDir`.
- Conflict retry: if `installFromFomod` returns `status: 'conflict'`, `tempDir` stays alive; `OverwriteConflictPromptInfo.fomodRequest` stores the request so `confirmOverwriteConflicts` can retry via `fomodInstall` with `allowOverwriteConflicts: true`.
- Duplicate flow: if `installFromFomod` returns `status: 'duplicate'`, `tempDir` is cleaned and `DuplicateInstallDialog` triggers a full re-install (FOMOD dialog reappears with fresh extraction).
- Store: `fomodPrompt: FomodPromptInfo | null` in `createDownloadsSlice`; actions `fomodInstall(FomodInstallRequest)` and `clearFomodPrompt()`.

## Conflict Detection System
- Two conflict kinds exist: `overwrite` (shared game-target file path) and `archive-resource` (same internal RED4 archive hash across different `.archive` files).
- `archive-resource` conflicts are detected by reading archive headers and file-entry hashes via `src/main/ipc/archiveParser.ts`, then cross-referencing against the bundled hash database at `src/main/resources/hashes.csv.gz`.
- Hash resolution and conflict computation live in `src/main/ipc/hashResolver.ts` and `src/main/ipc/modManager.ts`.
- Conflicts are stored in the Zustand store and recomputed on every install/uninstall/enable/disable via `scheduleConflictRefresh` in `src/renderer/store/slices/librarySliceHelpers.ts`.
- `src/renderer/utils/modConflictState.ts` handles recomputing the conflict snapshot from existing `ConflictInfo[]` without a full IPC round-trip (used after metadata-only state changes).
- `src/renderer/utils/archiveConflictDisplay.ts` contains display helpers (`getArchiveConflictHash`, `isUnresolvedArchiveConflict`) used across conflict UI components.
- Conflict summaries count **unique resource keys**, not pair rows. `overwrites` is the number of tracked resources where the mod has at least one lower-priority owner beneath it; `overwrittenBy` is the number of tracked resources where at least one later-loading owner wins over it. This is why three identical mods should show the middle copy as `+N` and `-N`, not double-count every pair.
- `ModConflictSummary.redundant` is true only when an enabled mod has at least one tracked deploy/archive resource and every tracked resource is overwritten by a later load-order owner. Partially overwritten mods are not redundant.
- `CALCULATE_MOD_CONFLICTS` emits pairwise `ConflictInfo` rows for every lower/higher owner pair on the same resource, not just loser -> final winner. The pairwise rows keep library selection highlighting and detail panels able to show both directions for a middle mod that wins over earlier mods and loses to later mods.
- The renderer optimistic recompute in `modConflictState.ts` mirrors the main-process rules, including unique resource summary sets, redundant detection, load-order pairwise rows, archive-resource summary keys, and exclusion of load-ordered archive deploy files from loose path conflicts.
- `hashes.csv.gz` is ~29 MB compressed and bundled in the installer resources; it is static per game version and does not contain CDPR game assets — only FNV1a hashes of internal resource paths.
- The base game release archives do NOT contain LXRS path tables — `resolve-lxrs.ps1` only works on **mod archives** created with WolvenKit (which injects LXRS sections when packing). The bundled `hashes.csv.gz` was sourced from WolvenKit's community hash database and covers ~1.7 million entries including full EP1/Phantom Liberty coverage. Missing hashes degrade gracefully — conflicts are still detected, only the display name shows as `Unresolved`.

## Nexus Downloads And Mod Updates
- Nexus download/update IPC lives in `src/main/ipc/nexusDownloader.ts`; renderer orchestration lives mostly in `createDownloadsSlice.ts` and `createLibrarySlice.ts`.
- **Nexus identity recovery for manual installs**: when an install has no `findNexusDownloadRecordByPath` match, `installer.ts` recovers the Nexus mod id/file id/version in two fallback steps before giving up: (1) parse a bundled `meta.ini` from the extracted tree (`parseMetaIniNexusInfo`/`findNexusInfoFromMetaIni`, reads `[General]`/`[installedFiles]` `modid`/`fileid`/`version`); (2) hash the source archive (MD5) and call the Nexus `md5_search` API via `lookupNexusModByMd5` (in `nexusDownloader.ts`), which also resolves category id→name. The MD5 step needs `settings.nexusApiKey`, is skipped for directory installs, and is best-effort (failures/no-match just leave the fields unset). This is what gives manually-downloaded mods the "Open on Nexus" action and version info. Existing installs only pick this up on reinstall.
- The Downloads folder is watched by the main process (`startDownloadsWatcher` in `index.ts`, non-recursive `fs.watch`) so externally-added/removed archives surface in the Downloads view without a manual refresh; it emits `IPC.DOWNLOADS_CHANGED` (debounced) and the renderer (`setupNxmListeners`) re-runs `refreshLocalFiles`. The watcher re-points on `SET_SETTINGS` and tears down on `before-quit`. Watcher-surfaced files do NOT get a `NEW` badge — that marker stays tied to in-app Nexus downloads.
- The Nexus API key can be set in two places: the `Nexus` step of the first-run onboarding wizard (`WelcomeScreen.tsx`, optional, validated live via `useNexusAccount`) and Settings > Nexus. Both persist to `settings.nexusApiKey`. Key validation goes through `IPC.NEXUS_VALIDATE_KEY` / the `useNexusAccount` hook.
- **Nexus update checking never does a full per-mod pass automatically.** It runs the cheap bulk pass once on launch and otherwise only on explicit user action; install/scan/reinstall/delete never trigger a check. Update statuses are persisted across sessions in the **main process** (`src/main/modUpdateCache.ts`, a JSON file in `userData`, exposed via `IPC.MOD_UPDATE_CACHE_GET`/`MOD_UPDATE_CACHE_SET`) — NOT renderer `localStorage`, which is wiped on every dev restart because dev `sessionData` is namespaced per process id (`index.ts`). The renderer hydrates the store from it asynchronously on boot via `hydrateModUpdates()` (called in `App.tsx` before the library scan) and writes through `persistModUpdates` (which fires `MOD_UPDATE_CACHE_SET`). Cached indicators show instantly without any request. Three triggers feed `checkModUpdates`:
  - **On launch** → fires `checkModUpdates({ force: true })` (bulk, silent, non-blocking) in `App.tsx` after hydrate+scan. Because the cache supplies the last-check timestamp, the adaptive window is usually `1d`, so this is ≈ 1 request (`updated.json`) plus a deep check only for the few mods changed since the last open — never one request per mod. The window opens immediately on the cached indicators; the refresh lands shortly after.
  - **Check Updates** toolbar button → same bulk pass but `notify:true` (toasts the result).
  - Per-mod **Check for Update** context-menu action → scoped (`modIds:[uuid]`, one `files.json`).
  - The bulk pass: one `updated.json?period=…` request lists every mod in the game changed within the window, and only the installed mods in that set get a `files.json` deep-check. The window is **adaptive**: `pickUpdatedPeriod(modUpdatesCheckedAt)` returns `1d`/`1w`/`1m` based on time since the last check. It scales to thousands of mods (≈ 1 + number-changed) because each mod's baseline (`nexusFileId`/`version`) is captured at install time, so detection only needs changes *since then*.
  - Both the bulk and scoped paths return only the mods they actually deep-checked and **merge** into the cached statuses (untouched mods keep their known status); a `full:true` pass (deep-check every mod, replaces the cache) still exists in the code as a latent capability but is no longer wired to any button. Updating a mod in place clears that mod's flag locally via `clearModUpdate` (no request). Persist any `modUpdates` mutation via `persistModUpdates`. Do NOT reintroduce an automatic *full per-mod* pass or a post-install/scan check.
- Update detection must be scoped to the installed file's own lineage, never the mod page's latest MAIN release. A mod page can host unrelated files (MAIN/OPTIONAL/PATCH) with independent versions — e.g. an installed OPTIONAL "Nova LUT Pack" v1.4 must not be flagged as updatable to the MAIN "Core" v2.5. Resolution order in `deepCheckMod` (`nexusDownloader.ts`): (1) follow the authoritative `file_updates` chain (`old_file_id` → `new_file_id`) from the installed `nexusFileId` to its newest successor; (2) if the chain has no link, match by identical file display name and a newer upload timestamp / version; (3) only when there is no recorded file id, fall back to comparing against the latest MAIN file by numeric version. Example: ArchiveXL `1.26.2` should detect Nexus `1.26.8`.
- Large Nexus `files.json` responses are allowed internally for full manual checks, but request logs should summarize them (count + small sample) instead of storing/rendering the full payload.
- Library-initiated mod updates should stay on the Library view, download through the existing NXM pipeline, replace the source mod automatically, and re-enable it after install. Do not navigate to Downloads for this flow.
- Normal Nexus downloads still belong in Downloads and use `NEW` markers. Clicking the archive row acknowledges `NEW`; install/reinstall also clears it. Inline mod updates should not leave a persistent `NEW` marker.
- Free Nexus accounts cannot mint direct download links from the API. For updates, open the Nexus files page and queue the update intent so the next matching `nxm://` link installs inline.
- Completed downloads auto-install by default, gated on the `autoInstallDownloads` setting (Settings > General "Install Behavior", default on). The `NXM_DOWNLOAD_COMPLETE` handler in `createDownloadsSlice.ts` calls `installCompletedDownload` unless the setting is `false` or the download is a mod-update intent (which has its own path). The shared duplicate/FOMOD/version/overwrite prompts still take over when needed.
- Library names prefer the clean Nexus file display name (`name`), not the raw `file_name` upload (which can carry author tokens/hashes). It is captured into the download registry (`displayName`) and used by `installer.ts` for both normal and FOMOD installs.
- Nexus mod category is resolved id→name via the game's category list (`/games/{game}.json`, cached for the session in `getGameCategoryMap`), fetched during update checks and on download, stored as `nexusCategoryId`/`nexusCategoryName` in `_metadata.json`. The renderer label helper is `src/renderer/utils/modCategoryDisplay.ts` (`getModCategoryLabel`), used by the Category column, sort, search, and Mod Card.
- Library column widths persist in `settings.libraryColumnWidths`; resize logic + grid template live in `src/renderer/features/library/libraryColumns.ts`.

## Core Commands
- Dev: npm run dev
- Local installer build: npm run build
- Publishable installer build: npm run publish
- Preview unpacked Windows output: npm run preview:win

## Release Rules
- package.json version is the release version used by electron-builder artifacts.
- **Cutting a release is one command**: `npm run release:patch|minor|major`. It bumps the version (package.json + package-lock.json) and rolls the CHANGELOG `[Unreleased]` section into a dated `## [X.Y.Z]` heading, then **folds those release files into the last local commit via `--amend`** so a release is a single commit (it keeps that commit's message). It only amends when HEAD hasn't been pushed yet; if HEAD is already on origin it falls back to a fresh `chore(release): bump version to X.Y.Z` commit so public history is never rewritten. The post-commit hook creates the annotated `vX.Y.Z` tag, then it pushes commit + tag. Pass `--no-push` to stop before pushing.
- **Workflow**: make code changes, update the CHANGELOG `[Unreleased]` section, commit everything in ONE feature commit, then run `release:*` — the bump folds into that commit. Do not create a separate docs/changelog commit.
- Pushing the tag to `main` triggers `.github/workflows/release.yml`, which fetches the usvfs SDK, builds the NSIS installer, and publishes the GitHub release (installer, blockmap, latest.yml).
- GitHub releases are expected to use a tag in the form vX.Y.Z.
- Auto-update depends on GitHub release artifacts generated by electron-builder, especially latest.yml and the NSIS installer assets.
- A locally built installer from npm run build does not publish update metadata to GitHub.

## Updater Expectations
- GitHub publish target is caiovaz567/Hyperion-Mod-Manager (matches the `publish` block in package.json and the `origin` remote).
- If update checks fail, inspect src/main/updater.ts, the release workflow, and whether the current version exists as a published GitHub release.
- Renderer update state lives in createUpdatesSlice.ts and header status lives in Header.tsx.
- The startup self-update check runs in the main process during the splash (`checkForUpdatesOnStartup` in updater.ts, fired from index.ts when `app.isPackaged && settings.autoUpdate`), so the header button is ready as the window opens. The result is cached and re-emitted on `APP_READY` (`flushCachedUpdateInfo`) to avoid a race with renderer listeners. Do not reintroduce a delayed renderer-side startup check; the Settings "Check for updates" button still calls `checkForUpdates` manually.
- Current updater UX is single-step: one header button starts download, shows inline progress, then installs and relaunches without a second click.
- The header self-update CTA should use the same borderless filled/tinted Hyperion button language as Library toolbar controls. Avoid colored outline boxes; progress should fill inside the button with a restrained yellow tint.
- Silent install behavior depends on src/main/updater.ts calling quitAndInstall with silent relaunch flags; if the NSIS wizard appears during auto-update, inspect that call first.
- Windows installer should stay current-user only. Do not add an all-users/current-user selection screen; keep NSIS installing for the current user.
- If first-install directory selection is needed, use assisted NSIS with a custom installer include that forces current-user mode instead of reverting to oneClick.
- **Portable layout + surgical uninstall (data-loss prevention)**: by design the suggested data folders live INSIDE the install directory — `getPathDefaults()` (settings.ts) returns `<installDir>\Mods` and `<installDir>\Downloads` for packaged builds (`getInstallDir()` = `dirname(app.getPath('exe'))`; falls back to `Documents/Hyperion` in dev), and "Use suggested" reads those. This is only safe because the NSIS uninstaller is **surgical**: the default electron-builder uninstaller does `RMDir /r $INSTDIR` (uninstaller.nsh) — used by BOTH manual uninstall AND auto-update (electron-builder runs the previous version's uninstaller with `--updated _?=$INSTDIR`, see installUtil.nsh `uninstallOldVersion`), so it would wipe Mods/Downloads and any other user folder. We override it via the `customRemoveFiles` macro in `build/installer.nsh`, which removes only Hyperion's own files (from the build-time manifest `build/uninstall-files.nsh` generated by the `afterPack` hook `scripts/after-pack.cjs`, wired in package.json `build.afterPack`) and then `RMDir $INSTDIR` **without `/r`** so the dir is removed only if empty — any user content survives. Do NOT reintroduce a recursive `$INSTDIR` delete, and keep the afterPack manifest generation in place. **Caveat**: the uninstaller that runs during an update is the *currently-installed* version's, so this protects installs of the fixed version onward; the first update FROM a pre-fix build still runs the old destructive uninstaller.


## UI Rules
- Preserve the dark industrial Hyperion look: near-black surfaces, precise yellow accent, restrained shadows.
- Do not introduce purple-heavy palettes, glassmorphism, neon Tron motifs, scanlines, or random gradients.
- Routine buttons, badges, status readouts, progress icons, toggles, and row actions should use borderless filled/tinted surfaces instead of colored outline boxes. Keep borders for containers, tables, separators, and structural grouping.
- Settings sections should use the shared `SettingCard` as clean two-column decision rows: explanation on the left, controls on the right, one shared alignment grid, subtle row separators, and no stacked colored outline boxes.
- Settings and App Logs tabs should both use the shared underline `SurfaceTabRail` pattern: icon + uppercase label, muted inactive tabs, and a thin yellow active underline instead of standalone boxed buttons.
- About-page outbound links should not look like plain text. Use filled secondary button surfaces with subtle inset boundaries and visible hover/focus states for GitHub, Releases, issue reporting, usvfs, MO2, and REDmodding.
- Managed Mods status filtering is a compact readout (`All N | On N | Off N`) under the title, not a dropdown. Keep the active item as yellow text with a thin underline, and show a small `Viewing enabled` / `Viewing disabled` clearable notice in the toolbar whenever the filter is not `All`.
- Conflict badges on mod rows are `+N` green, `-N` red, and yellow `!` for redundant. Their tooltip is a compact JSX tooltip with color-separated rows; keep the full combined explanation in `aria-label` for accessibility.
- Sidebar navigation is intentionally compact when collapsed and expands on hover.
- Current sidebar nav items are Mod Library, Downloads, and Settings, plus the Launch Game CTA.
- The terminal badge above navigation is decorative reference UI, hidden until sidebar hover. It is not a functional terminal.
- The terminal icon in the header is currently a placeholder for Logs.

## Implementation Preferences
- Prefer existing patterns in store slices and IPC services over ad hoc component state.
- Keep edits small and local; do not reformat unrelated files.
- When a change affects behavior, also update the docs that explain that behavior.
- When changing visuals, verify both collapsed and expanded sidebar states.
- For update-related changes, verify both packaged behavior assumptions and renderer error handling.

## Verification
- After a series of TS/React edits, run error checks or a build before finishing.
- For UI changes, verify against the intended reference rather than approximating from memory.
- For release/version changes, verify package.json and produced artifact naming stay aligned.

## Suggested Reading For Future AI Sessions
- Read package.json before changing release behavior.
- Read src/main/updater.ts and .github/workflows/release.yml before changing auto-update logic.

## Changelog
- Update the `[Unreleased]` section in CHANGELOG.md for every meaningful change before pushing.
- When cutting a release, move `[Unreleased]` entries under the new version heading and add the date.
