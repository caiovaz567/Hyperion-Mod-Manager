# usvfs-bridge

Native Node.js addon that bridges Hyperion (Electron) to **usvfs** - the User-Space Virtual File System from Mod Organizer 2. Enabled mods are mapped over the Cyberpunk 2077 game tree at launch time, while the mod library remains the source of truth.

Most mod payload stays virtual. Hyperion still has two intentional write paths around the VFS:

- **Bootstrap staging:** a small set of import-time loader files is copied into the game folder before launch, then removed after exit if they still match what Hyperion staged.
- **Runtime captures:** files created or changed by mod tools during gameplay are redirected to Hyperion's managed `Overwrite` folder and replayed on the next launch.

> usvfs is GPL-3.0 and Hyperion is GPL-3.0, so bundling it is license-compatible.

## Prerequisites

- **Visual Studio Build Tools 2022** with the *Desktop development with C++* workload + a Windows 10/11 SDK:
  ```powershell
  winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended"
  ```
- Node + npm (already present in the repo toolchain).

## Build

This module has no own `package.json` - its build deps (`node-addon-api`, `node-gyp`) live in the repo root. Run all commands from the repo root:

```bash
npm install           # once - installs node-addon-api + node-gyp
npm run fetch:usvfs   # downloads the pinned usvfs SDK into vendor/ (sha256-checked)
npm run build:native  # compiles for the project's Electron ABI → build/Release
```

The release workflow runs `npm run fetch:usvfs` before building. The local `npm run build` command chains `build:native` automatically once the SDK is present, and electron-builder bundles the output (`usvfs_bridge.node`, `usvfs_x64.dll`, `usvfs_proxy_x64.exe`) to `process.resourcesPath/usvfs` via `extraResources`.

Pinned versions: **Electron 30.5.1** · **usvfs v0.5.7.2** (sha256 `c6252eed78ee1c307733a4412cb68522cffc48107be4795c4e38b2b8d7c76d01`).

## Bridge API

Loaded at runtime through `src/main/vfsBridge.ts` (`loadVfsBridge()`), which resolves `build/Release` in dev and `process.resourcesPath/usvfs` when packaged.

```ts
mountVfs({
  instanceName,
  links: [{ source, dest, dir?, createTarget? }],
  blacklistExecutables?,
})
// Create a VFS and virtually link mod files over the game tree.
// dir=true creates a recursive directory mapping.
// createTarget=true redirects file creation/writes at dest into source.
// Later link wins, so load-order priority is determined by link order.
// blacklistExecutables excludes helper processes (crash reporters, etc.)
// from receiving DLL injection.

launchHookedProcess({ appPath, commandLine, cwd?, capture?, waitMs? })
// Spawn a process hooked into the mounted VFS.
// For the game: capture: false, waitMs: 0.

unmountVfs()
// Clear mappings and blacklist entries when the game exits.

dumpVfsTree()
// Return a readable dump of the active VFS mappings for diagnostics.

vfsProcesses()
// Return PIDs currently attached to the VFS.
```

The controller (main process) must remain alive while the game runs. `unmountVfs` is called automatically on game exit, kill, or app quit. Internally, it clears virtual mappings instead of calling `usvfsDisconnectVFS`, because usvfs 0.5.7.2 can crash when disconnecting a VFS that used a `CREATETARGET` overwrite link.

## Hyperion launch lifecycle

At **Launch Game**, Hyperion:

1. Scans enabled mods and builds ordered VFS links from the mod library to the game root.
2. Moves known runtime residue from the game folder into the managed `Overwrite` folder.
3. Stages import-time bootstrap files when needed.
4. Adds a writable `Overwrite -> gameRoot` `createTarget` layer, plus read links for previously captured files.
5. Mounts usvfs, writes a VFS dump to the launch log, and starts `Cyberpunk2077.exe` through `launchHookedProcess`.
6. Polls the launched process and attached VFS processes, then clears mappings, migrates runtime residue, and removes staged bootstrap files after exit.

Launch diagnostics are appended to `logs/vfs-launch.log` under Electron's `userData` directory.

## Bootstrap staging

Windows resolves static DLL imports before usvfs file hooks are active. Some Cyberpunk mod loaders therefore must exist physically for the first loader pass. Hyperion stages only import-time loader/config files:

- `bin/x64/*` with `.dll`, `.asi`, `.ini`, `.cfg`, `.toml`, or `.json`
- `bin/x64/plugins/*` with `.dll`, `.asi`, `.ini`, `.cfg`, `.toml`, or `.json`
- top-level `red4ext/*` framework files with those same extensions

Plugin support folders such as `bin/x64/plugins/cyber_engine_tweaks/` remain virtual and are loaded after hooks are active. If Hyperion creates a temporary parent directory such as `bin/x64/plugins` or `red4ext`, it writes a `.hyperion-vfs-bootstrap` marker and removes that directory after the game exits. Pre-existing physical files or folders are kept, and staged files that changed during the run are preserved instead of being deleted.

## Runtime captures

The writable overwrite layer redirects runtime-created files (logs, configs, caches, databases, and similar mod-tool output) into an `Overwrite` folder beside the Hyperion mod library parent. Captured files are linked back into the VFS on future launches so settings written by tools such as CET or RED4ext persist without leaving managed files in the game folder between sessions. Older AppData `vfs-overwrite` contents are migrated into the current location.

## Licensing

usvfs is GPL-3.0 with a section-7 additional permission for FOSS. Bundling it requires Hyperion to remain FOSS and to include the usvfs notice, license, and repository link. See [`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md) and [`USVFS-LICENSE.txt`](./USVFS-LICENSE.txt).
