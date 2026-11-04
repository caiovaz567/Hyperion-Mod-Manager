# Hyperion Project Guide

## Purpose
- Hyperion is an Electron + React desktop mod manager for Cyberpunk 2077.
- Primary user flows: first-run setup, library management, download inspection, install/reinstall, launch game, self-update.
- Keep the app feeling sharp, restrained, and production-oriented. Avoid novelty UI that fights readability.

## How this guide works
This file is the short index and is loaded in every session. **Before changing an area, read its guide below.** The rules here are the ones that cause real damage when broken; the guides hold the reasoning and the details.

| Before you touch... | Read |
|---|---|
| Any renderer UI: screens, layout, copy, visual behavior | [DESIGN.md](DESIGN.md) and [docs/agents/ui.md](docs/agents/ui.md) |
| User-facing text, translations | [docs/agents/i18n.md](docs/agents/i18n.md) |
| IPC, settings, library scan, metadata, renderer lockdown | [docs/agents/architecture.md](docs/agents/architecture.md) |
| Launch Game, usvfs, bootstrap staging, REDmod, Runtime Captures | [docs/agents/deployment.md](docs/agents/deployment.md) |
| Conflict detection, archive parsing, the hash database | [docs/agents/conflicts.md](docs/agents/conflicts.md) |
| Nexus downloads, API key, update checks, mod naming, duplicates | [docs/agents/nexus.md](docs/agents/nexus.md) |
| FOMOD installs | [docs/agents/fomod.md](docs/agents/fomod.md) |
| Tests | [docs/agents/tests.md](docs/agents/tests.md) |
| Releases, self-update, the installer or uninstaller | [docs/agents/release.md](docs/agents/release.md) |

## Source Of Truth
- **Read DESIGN.md before changing anything in the renderer UI.** It holds the design rules and is not loaded automatically.
- If the code and DESIGN.md disagree, update the code and then update DESIGN.md in the same task.
- For larger visual explorations, use Google Stitch first to prototype screen direction, then implement the chosen direction in code.

## Stack
- Electron main process in src/main.
- React renderer in src/renderer.
- Shared IPC contracts in src/shared/types.ts.
- State management uses Zustand slices under src/renderer/store/slices.
- UI is HeroUI v3 on React 19 + Tailwind v4. There is no MUI, Emotion or framer-motion.

## Rules that must not be broken

**Data and game safety**
- Never reintroduce a recursive `$INSTDIR` delete in the uninstaller, and keep the afterPack manifest generation. Updates and uninstalls would wipe the user's `Mods` and `Downloads` folders.
- Bootstrap staging stays crash-safe through its persisted manifest, and cleanup removes both `copied` and `already-present` entries with no "still matches the source" guard. A stray loader left in `bin/x64/plugins` crashes a mod-free launch.
- Never pass `capture: true` to `launchHookedProcess` for a long-running child. It freezes the whole main process.
- Never unmount the VFS while a process is attached to it. Every mod file would vanish mid-session.
- Runtime Captures are never moved, parked or filtered by enable/disable state. Only deleting a mod cleans its own private capture slot.
- Never create temp dirs inside `libraryPath`.
- FOMOD paths and server-supplied download names are untrusted. Never join them with a bare `path.join`; use `resolvePathInsideRoot` / `sanitizeDownloadFileName`.

**Settings, IPC and metadata**
- New IPC channels go in the `IPC` map in `src/shared/types.ts`, or the preload bridge blocks them.
- `SET_SETTINGS` takes a partial. Never send a full renderer-side settings copy.
- `UPDATE_MOD_METADATA` callers send narrow patches. Spreading a slim store mod wipes the on-disk `files`.
- The cached meta from `readMetadata` is shared. Mutate it only if you persist with `writeMetadata` right after.
- The library scan ignores symlinks. Folder names keep spaces and hyphens; do not bring back underscore names or batch renames.

**Nexus**
- The decrypted API key stays in the main process and never crosses IPC to the renderer. Keep the `isPackaged` gate on encryption and `redirect: 'error'` in `nexusGet`.
- Never add an automatic full per-mod update check, or a check after install, scan, reinstall or delete.
- Update detection follows the installed file's own lineage, never the page's latest MAIN file.
- Duplicate detection uses the Nexus file id, not the name.

**Conflicts and performance**
- Do not preload the hash database at startup, and do not add per-row normalization to its load path.
- Do not move LXRS/kark name resolution onto the eager install or index path.

**UI**
- Every user-facing string goes through i18n: add the key to `en.json` and `pt-BR.json`, render with `t()`. A raw English literal in the renderer is a bug. The exceptions are listed in [docs/agents/i18n.md](docs/agents/i18n.md).
- New colors use CSS tokens, never literal identity colors. `*-rgb` tokens are space-separated.
- No drop shadows anywhere. No purple-heavy palettes, glassmorphism, neon motifs, scanlines or random gradients.
- Icons are Lucide through `Icon.tsx` only. Add missing names to its `ICONS` map.
- Tabs use `UnderlineTabs` or `SegmentedTabs`, never a third style.
- There is no theme selector and no second splash. Do not bring them back.

**Releases**
- A release is one command, `npm run release:patch|minor|major`, folded into one feature commit. See [docs/agents/release.md](docs/agents/release.md).
- When you change deploy paths, mod-type detection, capture cleanup, conflict math, FOMOD parsing or update lineage, update the matching test in the same task.

## Core Commands
- Dev: npm run dev
- Unit tests: npm test (vitest; watch mode via npm run test:watch)
- Typecheck: npm run typecheck
- E2E smoke test: npm run test:e2e (local only, run it before cutting a release)
- Local installer build: npm run build
- Publishable installer build: npm run publish
- Preview unpacked Windows output: npm run preview:win

## Implementation Preferences
- Prefer existing patterns in store slices and IPC services over ad hoc component state.
- Keep edits small and local; do not reformat unrelated files.
- When a change affects behavior, also update the docs that explain that behavior, including the matching guide in docs/agents/.
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
