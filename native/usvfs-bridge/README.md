# usvfs-bridge

Native bridge between Hyperion (Electron/Node) and **usvfs** — the User-Space
Virtual File System used by Mod Organizer 2. The goal is virtual deployment:
the game sees a merged view of the game folder + enabled mods, while mod payload
stays out of the game directory (no symlinks, no admin/UAC, no duplication,
cross-drive).

Import-time DLL proxy loaders are the one exception. Windows resolves these
before usvfs file hooks can affect DLL dependency loading, so Hyperion stages
only path-based bootstrap candidates physically before launching the
usvfs-hooked game: top-level `bin/x64` DLL/ASI/INI/config files and direct
`bin/x64/plugins` DLL/ASI/INI/config files. Sibling support folders and runtime
state stay virtual/overwrite-backed. If an older run left plugin support folders
physically in the game directory, Hyperion migrates their non-mod files into the
VFS overwrite folder before launching so future writes do not leak back into the
game folder. Cyber Engine Tweaks' `version.dll` + ASI loader is one example, not
a hardcoded special case.

> usvfs is GPL-3.0 and Hyperion is GPL-3.0, so bundling it is license-compatible.

## Prerequisites

- **Visual Studio Build Tools 2022** with the *Desktop development with C++*
  workload + a Windows 10/11 SDK. Install:
  ```powershell
  winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended"
  ```
- Node + npm (already present in the repo toolchain).

## Implementation phases

Each phase has a single, verifiable checkpoint. We do not advance until the
current phase's checkpoint passes.

| Phase | Goal | Checkpoint | Status |
|------|------|-----------|--------|
| **0** | Trivial N-API addon (no usvfs yet) | `node smoke-test.js` prints "Phase 0 OK" | ✅ done |
| **1** | Same addon loads under Electron's ABI | Electron main process `require`s it at runtime | ✅ done |
| **2a** | Link against usvfs; call `usvfsVersionString()` | returns `0.5.7.2` from inside Electron | ✅ done |
| **2b** | Mount a VFS; hooked process reads a virtual-only file | `phase2b-electron-test.js` → "PHASE 2b OK" | ✅ done |
| **3a** | Bridge lifecycle API (`mountVfs`/`launchHookedProcess`/`unmountVfs`); multi-file mapping + load-order priority + virtual dir listing | `phase3a-electron-test.js` → "PHASE 3a OK" | ✅ done |
| **3b** | Wire into the app: `buildEnabledModLinks` (modManager.ts) + `LAUNCH_GAME` routes through `mountVfs`+`launchHookedProcess`, unmount on game exit / kill / quit. Legacy symlink spawn kept as fallback | code complete + type-checks; runtime confirmed in Phase 4 | ✅ code |
| **4** | Real Cyberpunk 2077 validation (archive/, r6/, red4ext/, etc.) | mods load in-game with the game folder untouched | ⏳ next |

### Bridge API (validated)
- `mountVfs({ instanceName, links: [{source, dest}] })` — create VFS + virtual-link library files over the game tree (later link wins = load-order priority). Keep the controller (main process) alive while the game runs.
- `mountVfs({ blacklistExecutables })` can also exclude helper processes from
  seeing the VFS. Hyperion uses this for crash reporters so bootstrap proxy DLLs
  meant for `Cyberpunk2077.exe` do not get injected into helper executables.
- `launchHookedProcess({ appPath, commandLine, cwd?, capture?, waitMs? })` — spawn a process hooked into the mounted VFS. Game: `capture:false, waitMs:0`.
- `unmountVfs()` — tear down (call when the game exits).

Built addon ABI target: **Electron 30.5.1** (`--target=30.5.1 --dist-url=https://electronjs.org/headers`).
usvfs pinned: **v0.5.7.2** (sha256 `c6252eed78ee1c307733a4412cb68522cffc48107be4795c4e38b2b8d7c76d01`).

## Build & validate

This module has **no own `package.json` / `node_modules`** — its build deps
(`node-addon-api`, `node-gyp`) live in the repo root, and all commands run from
the root:

```bash
npm install            # once (installs node-addon-api + node-gyp at root)
npm run fetch:usvfs    # downloads the pinned usvfs SDK into vendor/ (sha256-checked)
npm run build:native   # compiles for the project's Electron ABI -> build/Release
```

The release build runs `build:native` automatically (it is chained into
`build` / `package` / `publish`), and electron-builder bundles the result
(`usvfs_bridge.node` + `usvfs_x64.dll` + `usvfs_proxy_x64.exe`) to
`process.resourcesPath/usvfs` via `extraResources`.

Validate with the harnesses (launched under Electron so the addon ABI matches):

```bash
node_modules/electron/dist/electron.exe native/usvfs-bridge/test/vfs-read.test.js
node_modules/electron/dist/electron.exe native/usvfs-bridge/test/vfs-priority.test.js
```

The app loads the addon through `src/main/vfsBridge.ts` (`loadVfsBridge()`),
which resolves `build/Release` in dev and `process.resourcesPath/usvfs` when
packaged, and returns diagnostics if the addon is unavailable.

## Notes / open risks (tracked)

- **VFS scope**: only processes launched *through* usvfs see the mods. Hyperion's
  "Launch Game" must route the game (and any tool that needs the mods) through
  the bridge.
- **DLL proxy bootstrap**: import-time proxy DLLs cannot rely on pure VFS
  visibility. Stage only the path-based bootstrap set, then keep support assets
  in usvfs and generated files in the overwrite layer.
- **AV friction**: usvfs uses API hooking/DLL injection; antivirus may flag it.
  CP2077 is single-player (no anti-cheat), so this is false-positive risk, not bans.
- **VFS lifetime**: the controller (main process) must stay alive while the game
  runs; unmount only on game exit.
- **Helper process blacklist**: crash/error reporters are excluded from usvfs so
  they do not load game bootstrap DLLs such as `version.dll`.

## Licensing

usvfs is GPL-3.0 with a section-7 additional permission for FOSS. Bundling it
obliges Hyperion to stay FOSS, ship no proprietary components, and show the
usvfs notice + license + repo link in the UI and docs. See
[`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md) and
[`USVFS-LICENSE.txt`](./USVFS-LICENSE.txt).
