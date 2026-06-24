# usvfs-bridge

Native Node.js addon that bridges Hyperion (Electron) to **usvfs** — the User-Space Virtual File System from Mod Organizer 2. Enabled mods are mapped over the game tree at launch time; mod files stay in the library and the game directory is never touched.

Import-time DLL proxy loaders are the one exception: Windows resolves static DLL imports before usvfs file hooks are active, so Hyperion physically stages a small bootstrap set (`bin/x64` and `bin/x64/plugins` DLL/ASI/INI files) before the hooked game launch. All other mod payload stays virtual.

> usvfs is GPL-3.0 and Hyperion is GPL-3.0, so bundling it is license-compatible.

## Prerequisites

- **Visual Studio Build Tools 2022** with the *Desktop development with C++* workload + a Windows 10/11 SDK:
  ```powershell
  winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended"
  ```
- Node + npm (already present in the repo toolchain).

## Build

This module has no own `package.json` — its build deps (`node-addon-api`, `node-gyp`) live in the repo root. Run all commands from the repo root:

```bash
npm install           # once — installs node-addon-api + node-gyp
npm run fetch:usvfs   # downloads the pinned usvfs SDK into vendor/ (sha256-checked)
npm run build:native  # compiles for the project's Electron ABI → build/Release
```

The release build chains `build:native` automatically, and electron-builder bundles the output (`usvfs_bridge.node`, `usvfs_x64.dll`, `usvfs_proxy_x64.exe`) to `process.resourcesPath/usvfs` via `extraResources`.

Pinned versions: **Electron 30.5.1** · **usvfs v0.5.7.2** (sha256 `c6252eed78ee1c307733a4412cb68522cffc48107be4795c4e38b2b8d7c76d01`).

## Bridge API

Loaded at runtime through `src/main/vfsBridge.ts` (`loadVfsBridge()`), which resolves `build/Release` in dev and `process.resourcesPath/usvfs` when packaged.

```ts
mountVfs({ instanceName, links: [{ source, dest }], blacklistExecutables? })
// Create a VFS and virtually link mod files over the game tree.
// Later link wins — load-order priority is determined by link order.
// blacklistExecutables excludes helper processes (crash reporters, etc.)
// from receiving DLL injection.

launchHookedProcess({ appPath, commandLine, cwd?, capture?, waitMs? })
// Spawn a process hooked into the mounted VFS.
// For the game: capture: false, waitMs: 0.

unmountVfs()
// Tear down the VFS. Call when the game exits.
```

The controller (main process) must remain alive while the game runs. `unmountVfs` is called automatically on game exit, kill, or app quit.

## Licensing

usvfs is GPL-3.0 with a section-7 additional permission for FOSS. Bundling it requires Hyperion to remain FOSS and to include the usvfs notice, license, and repository link. See [`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md) and [`USVFS-LICENSE.txt`](./USVFS-LICENSE.txt).
