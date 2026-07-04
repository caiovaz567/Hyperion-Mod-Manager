<p align="center">
  <img src="src/main/resources/hyperion-logo.png" alt="Hyperion" width="520" />
</p>

<p align="center">
  A mod manager for Cyberpunk 2077.
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/caiovaz567/Hyperion-Mod-Manager?color=006FEE&label=release&cacheSeconds=300" alt="Latest release" />
  <img src="https://img.shields.io/badge/game-Cyberpunk%202077-fcee09" alt="Game: Cyberpunk 2077" />
  <img src="https://img.shields.io/badge/platform-Windows-ff3b30" alt="Platform: Windows" />
  <img src="https://img.shields.io/github/license/caiovaz567/Hyperion-Mod-Manager?color=34d399" alt="License: GPL-3.0" />
</p>

---

Hyperion is a desktop application for managing Cyberpunk 2077 mods. It keeps your mod library organized, installs mods without touching the game folder, detects conflicts, and launches the game - all from one place.

<p align="center">
  <img src="https://github.com/user-attachments/assets/ec164022-4c90-4e4f-8838-36a3aefb043c" alt="Hyperion" width="900" />
</p>

## Why Hyperion Exists

Hyperion started as a small personal experiment: I wanted to try Claude Code, had just started modding Cyberpunk 2077, and thought building a mod manager for my own setup would be a fun test project. Then the fun part got a little out of hand.

Since then, Hyperion has become the manager I use for my own Cyberpunk 2077 mod list. It grew around the things I wanted day to day: a clean library, clear conflicts, predictable load order, and a launch flow that keeps the game folder under control. After using it privately for a while, I decided to make it public in case it is useful to someone else too.

## Features

### Library
- **Full mod library management** - enable/disable per mod or in bulk, group mods with collapsible separators, and reorder load priority by drag-and-drop (higher order wins on shared paths)
- **Conflict detection** - flags both file-path overwrites and archive-resource conflicts (internal RED4 hash collisions across `.archive` files), with a per-mod win/loss breakdown and one-click jump to the winning/losing mod
- **FOMOD installer** - full wizard support for conditional installs (body type, textures, options) with image previews
- **Archive support** - install from `.zip`, `.rar`, and `.7z`, with live extraction progress and reinstall from the original source at any time
- **Built to scale** - stays fast and light on memory with thousands of mods and downloads

### Game folder stays clean
- **Virtual deployment (usvfs)** - mods are mapped over the game tree at launch using usvfs, the same User-Space VFS behind Mod Organizer 2. Nothing is copied or linked into the game folder; the library stays the source of truth, and only tiny runtime bootstrap files are staged when needed. Game, library, and downloads can each live on different drives
- **REDmod support** - REDmods are compiled and loaded entirely inside the virtual file system: Hyperion runs `redMod deploy` against the virtual `mods/` tree, captures the compiled output outside the game folder, respects your library load order, and launches the game with `-modded`
- **Runtime captures** - files written by mod tools during gameplay (CET keybindings, generated configs, logs) are captured in a managed Overwrite folder and replayed on future launches, so settings persist while the game folder stays untouched

### Nexus Mods
- **One-click installs** via `nxm://` links, with automatic install after download
- **Update detection** scoped to each installed file's own lineage - an optional file is never flagged against an unrelated main release
- **Premium/Free aware** download handling, plus MD5 identity recovery for manually downloaded archives

### Interface
- **Modern UI** built with HeroUI - dark and light modes (or follow the system), with eight accent colors that re-skin the entire app live
- **Multilingual** - English and Brazilian Portuguese, switchable live; the architecture is ready for community translations
- **Live launch feedback** - a progress card narrates the whole launch pipeline (mod scan, VFS mount, REDmod compilation, game start) with real tool output
- **App logs** - built-in inspector for runtime events and Nexus API traffic, with masked credentials
- **Automatic updates** - delivered through GitHub Releases with one-click install

## Requirements

- Windows 10 / 11 (64-bit)
- A copy of Cyberpunk 2077

## Getting started

Download the latest Windows installer from the [Releases](https://github.com/caiovaz567/Hyperion-Mod-Manager/releases/latest) page.

On first launch, a one-time setup wizard walks you through everything Hyperion needs:

1. **Game** - where Cyberpunk 2077 is installed (auto-detected in the background)
2. **Mod library** - the folder that holds your installed mods
3. **Downloads** - the folder Hyperion watches for archives (optional)
4. **Nexus** - your personal [Nexus Mods API key](https://www.nexusmods.com/settings/api-keys) for downloads and update checks (optional)

Every path is validated inline, and anything you skip can be set later in **Settings**.

## Tech stack

| Layer | Technology |
|---|---|
| Shell | [Electron](https://www.electronjs.org/) (main process in TypeScript) |
| UI | [React 19](https://react.dev/) + [HeroUI v3](https://heroui.com/) + [Tailwind CSS v4](https://tailwindcss.com/) |
| State | [Zustand](https://zustand-demo.pmnd.rs/) |
| Virtual file system | [usvfs](https://github.com/ModOrganizer2/usvfs) via a native Node.js bridge |
| Packaging & updates | electron-builder + GitHub Releases |

## Building from source

```bash
npm install
npm run fetch:usvfs   # fetch the pinned usvfs binaries
npm run build:native  # build the usvfs native bridge
npm run dev           # run in development
npm run build         # build a local installer
```

## License

Hyperion is free software licensed under the [GNU General Public License v3.0](LICENSE).

Virtual deployment is powered by [usvfs](https://github.com/ModOrganizer2/usvfs) (GPL-3.0, © Sebastian Herbord / Mod Organizer 2 contributors). See [`native/usvfs-bridge/THIRD_PARTY_LICENSES.md`](native/usvfs-bridge/THIRD_PARTY_LICENSES.md) for the full notice.

---

<sub>Hyperion is an unofficial, fan-made tool and is not affiliated with or endorsed by CD PROJEKT RED.</sub>
