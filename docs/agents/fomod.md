# FOMOD Installer

Part of the project guide. The short index and the must-not-break rules are in [AGENTS.md](../../AGENTS.md).

## FOMOD Installer

- FOMOD is a mod configuration format (XML-based) used widely on Nexus Mods to offer conditional install options (body type, hair color, etc.).
- Detection: after extraction in `src/main/ipc/installer.ts`, the main `installMod` function checks for `fomod/ModuleConfig.xml` at the `extractRoot`. If found, it returns `status: 'fomod'` with the XML string and `tempDir`/`extractRoot` paths. The `tempDir` is intentionally kept alive for the FOMOD flow.
- XML parsing is done in the renderer via `src/renderer/utils/fomodParser.ts` using the browser-native `DOMParser`. Key exports: `parseFomodXml`, `buildInitialSelections`, `resolveInstallEntries`, `fomodImageUrl`.
- The wizard UI is `src/renderer/features/ui/FomodInstallerDialog.tsx` - a multi-step modal rendered via `createPortal` in App.tsx.
- When the user confirms Install, the renderer calls `IPC.FOMOD_INSTALL` (`install:fomod`) with a `FomodInstallRequest` containing the resolved `installEntries`. The main process copies selected files into a staging dir, runs conflict/type detection, then commits to the library.
- **FOMOD paths are untrusted input.** `copyFomodEntries` resolves every entry's `source` (against `extractRoot`) and `destination` (against the staging dir) through `resolvePathInsideRoot`, which returns `null` for `..` escapes and drive-qualified paths; any escape throws and fails the whole install (the catch cleans up temp/staging dirs). Never join a FOMOD-supplied path with a bare `path.join` - a malicious `ModuleConfig.xml` could otherwise write anywhere the user can (e.g. the Startup folder). Covered by `tests/installerHelpers.test.ts`.
- On Cancel, the renderer calls `IPC.FOMOD_CANCEL` (`install:fomodCancel`) to clean up `tempDir`.
- Conflict retry: if `installFromFomod` returns `status: 'conflict'`, `tempDir` stays alive; `OverwriteConflictPromptInfo.fomodRequest` stores the request so `confirmOverwriteConflicts` can retry via `fomodInstall` with `allowOverwriteConflicts: true`.
- Duplicate flow: if `installFromFomod` returns `status: 'duplicate'`, `tempDir` is cleaned and `DuplicateInstallDialog` triggers a full re-install (FOMOD dialog reappears with fresh extraction).
- Name-choice flow: when the FOMOD is a sibling file of an already-installed Nexus mod page, `installFromFomod` returns `status: 'name-choice'` with `tempDir` kept alive (checked before the full extraction); `NameChoicePromptInfo.fomodRequest` stores the request so `InstallNameDialog` can retry via `fomodInstall` with `customName` - wizard selections intact. Cancelling goes through `IPC.FOMOD_CANCEL`. Its duplicate check is Nexus-identity-aware like the normal path (same `findDuplicateMod` + customName-collision fallback).
- Store: `fomodPrompt: FomodPromptInfo | null` in `createDownloadsSlice`; actions `fomodInstall(FomodInstallRequest)` and `clearFomodPrompt()`.
