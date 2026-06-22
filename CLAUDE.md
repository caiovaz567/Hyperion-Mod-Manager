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
- Settings, mod scan, path validation, install/reinstall, and updater all flow through IPC.
- Mod library scan must ignore symlinks/junctions.
- Installed mod metadata stores sourcePath/sourceType so reinstalls can reuse the original source.

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
- `hashes.csv.gz` is ~29 MB compressed and bundled in the installer resources; it is static per game version and does not contain CDPR game assets — only FNV1a hashes of internal resource paths.
- The base game release archives do NOT contain LXRS path tables — `resolve-lxrs.ps1` only works on **mod archives** created with WolvenKit (which injects LXRS sections when packing). The bundled `hashes.csv.gz` was sourced from WolvenKit's community hash database and covers ~1.7 million entries including full EP1/Phantom Liberty coverage. Missing hashes degrade gracefully — conflicts are still detected, only the display name shows as `Unresolved`.

## Nexus Downloads And Mod Updates
- Nexus download/update IPC lives in `src/main/ipc/nexusDownloader.ts`; renderer orchestration lives mostly in `createDownloadsSlice.ts` and `createLibrarySlice.ts`.
- Startup and manual `Check Updates` must use a full per-mod Nexus file pass (`full: true`) so every installed Nexus mod gets a reliable status and older available updates are not missed. Startup begins this check during the splash screen but only waits briefly before opening the Library; slow Nexus responses continue non-blocking. Later automatic library refreshes may keep the cheaper `updated.json?period=1m` path.
- Update detection must be scoped to the installed file's own lineage, never the mod page's latest MAIN release. A mod page can host unrelated files (MAIN/OPTIONAL/PATCH) with independent versions — e.g. an installed OPTIONAL "Nova LUT Pack" v1.4 must not be flagged as updatable to the MAIN "Core" v2.5. Resolution order in `deepCheckMod` (`nexusDownloader.ts`): (1) follow the authoritative `file_updates` chain (`old_file_id` → `new_file_id`) from the installed `nexusFileId` to its newest successor; (2) if the chain has no link, match by identical file display name and a newer upload timestamp / version; (3) only when there is no recorded file id, fall back to comparing against the latest MAIN file by numeric version. Example: ArchiveXL `1.26.2` should detect Nexus `1.26.8`.
- Large Nexus `files.json` responses are allowed internally for full manual checks, but request logs should summarize them (count + small sample) instead of storing/rendering the full payload.
- Library-initiated mod updates should stay on the Library view, download through the existing NXM pipeline, replace the source mod automatically, and re-enable it after install. Do not navigate to Downloads for this flow.
- Normal Nexus downloads still belong in Downloads and use `NEW` markers. Clicking the archive row acknowledges `NEW`; install/reinstall also clears it. Inline mod updates should not leave a persistent `NEW` marker.
- Free Nexus accounts cannot mint direct download links from the API. For updates, open the Nexus files page and queue the update intent so the next matching `nxm://` link installs inline.

## Core Commands
- Dev: npm run dev
- Build app bundles: npm run build
- Local installer build: npm run dist
- Publishable installer build: npm run dist:publish
- Preview unpacked Windows output: npm run preview:win

## Release Rules
- package.json version is the release version used by electron-builder artifacts.
- npm run dist must build the installer for the current package.json version with no extra manual edits.
- GitHub releases are expected to use a tag in the form vX.Y.Z.
- Auto-update depends on GitHub release artifacts generated by electron-builder, especially latest.yml and the NSIS installer assets.
- A locally built installer from npm run dist does not publish update metadata to GitHub.

## Updater Expectations
- GitHub publish target is caiomarcelo567/Hyperion-Mod-Manager.
- If update checks fail, inspect src/main/updater.ts, the release workflow, and whether the current version exists as a published GitHub release.
- Renderer update state lives in createUpdatesSlice.ts and header status lives in Header.tsx.
- Current updater UX is single-step: one header button starts download, shows inline progress, then installs and relaunches without a second click.
- Silent install behavior depends on src/main/updater.ts calling quitAndInstall with silent relaunch flags; if the NSIS wizard appears during auto-update, inspect that call first.
- Windows installer should stay current-user only. Do not add an all-users/current-user selection screen; keep NSIS installing for the current user.
- If first-install directory selection is needed, use assisted NSIS with a custom installer include that forces current-user mode instead of reverting to oneClick.


## UI Rules
- Preserve the dark industrial Hyperion look: near-black surfaces, precise yellow accent, restrained shadows.
- Do not introduce purple-heavy palettes, glassmorphism, neon Tron motifs, scanlines, or random gradients.
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
