# Hyperion

<p align="center">
  <img src="src/main/resources/hyperion-logo.svg" alt="Hyperion" width="520" />
</p>

<p align="center">
  A mod manager for Cyberpunk 2077.
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/caiovaz567/Hyperion-Mod-Manager?color=fcee09&label=release" alt="Latest release" />
  <img src="https://img.shields.io/badge/platform-Windows-2a2a2a" alt="Platform: Windows" />
  <img src="https://img.shields.io/github/license/caiovaz567/Hyperion-Mod-Manager?color=34d399" alt="License: GPL-3.0" />
</p>

---

Hyperion is a desktop application for managing Cyberpunk 2077 mods. It keeps your mod library organized, lets you install and reinstall from original sources, and launches the game — all from one place.

<p align="center">
  <img src="https://github.com/user-attachments/assets/fa6222aa-1835-46fb-a1a2-f3cc91a6638b" alt="Hyperion mod library" width="900" />
</p>

## Features

- **Full mod library management** — enable/disable per mod or in bulk, group mods with separators, and reorder load priority by drag-and-drop (Mod Organizer–style: higher order wins on shared paths)
- **Virtual deployment (usvfs)** — mods are mapped over the game tree at launch using usvfs, the same User-Space VFS behind Mod Organizer 2. No file copies, no admin UAC prompts. Your mod library, downloads folder, and game installation can each live on different drives — an SSD for the game, a large HDD for mods, wherever makes sense
- **Nexus Mods integration** — install via `nxm://` links, automatic update detection scoped to each file's own lineage, and Premium/Free aware download handling
- **FOMOD installer** — full wizard support for conditional installs (body type, textures, options) with image previews
- **Conflict detection** — flags both file-path overwrites and archive-resource conflicts (internal RED4 hash collisions across `.archive` files), with a per-mod win/loss breakdown
- **Archive support** — install from `.zip`, `.rar`, and `.7z`, with live extraction progress and reinstall from the original source at any time
- **Downloads inspection** — browse your downloads folder and inspect archives before installing
- **Launch & monitor** — start Cyberpunk 2077 directly from the app
- **Automatic updates** — delivered through GitHub Releases

## Screenshots

### FOMOD Installer
Conditional install wizard with image previews — choose body type, textures, and options before anything lands in the library.

<!-- Upload via GitHub issue drag-and-drop, paste the user-attachments URL below -->
![FOMOD installer](https://github.com/user-attachments/assets/PASTE_FOMOD_URL_HERE)

### Conflict Inspector
See exactly which files and archive resources a mod wins or loses against the rest of your load order.

![Conflict inspector](https://github.com/user-attachments/assets/PASTE_CONFLICT_URL_HERE)

### Downloads
Browse, search, and install from your downloads folder — with live extraction progress.

![Downloads](https://github.com/user-attachments/assets/PASTE_DOWNLOADS_URL_HERE)

## Requirements

- Windows 10 / 11 (64-bit)
- A copy of Cyberpunk 2077

## Download

Get the latest Windows installer from the [Releases](https://github.com/caiovaz567/Hyperion-Mod-Manager/releases/latest) page.

## Building from source

```bash
npm install
npm run dev      # run in development
npm run build    # build a local installer
```

## License

Hyperion is free software licensed under the [GNU General Public License v3.0](LICENSE).

Virtual deployment is powered by [usvfs](https://github.com/ModOrganizer2/usvfs) (GPL-3.0, © Sebastian Herbord / Mod Organizer 2 contributors). See [`native/usvfs-bridge/THIRD_PARTY_LICENSES.md`](native/usvfs-bridge/THIRD_PARTY_LICENSES.md) for the full notice.

---

<sub>Hyperion is an unofficial, fan-made tool and is not affiliated with or endorsed by CD PROJEKT RED.</sub>
