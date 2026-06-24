# Hyperion

<p align="center">
  <img src="src/main/resources/hyperion-logo.svg" alt="Hyperion" width="520" />
</p>

<p align="center">
  A mod manager for Cyberpunk 2077.
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/caiovaz567/Hyperion-Mod-Manager?color=fcee09&label=release&cacheSeconds=300" alt="Latest release" />
  <img src="https://img.shields.io/badge/game-Cyberpunk%202077-fcee09" alt="Game: Cyberpunk 2077" />
  <img src="https://img.shields.io/badge/platform-Windows-2a2a2a" alt="Platform: Windows" />
  <img src="https://img.shields.io/github/license/caiovaz567/Hyperion-Mod-Manager?color=34d399" alt="License: GPL-3.0" />
</p>

---

Hyperion is a desktop application for managing Cyberpunk 2077 mods. It keeps your mod library organized, lets you install and reinstall from original sources, and launches the game — all from one place.

<p align="center">
  <img src="https://github.com/user-attachments/assets/e0458ebb-aad1-4ff5-90d1-38c10bbeba0e" alt="Hyperion mod library" width="900" />
</p>

## Why Hyperion Exists

Hyperion started as a small personal experiment: I wanted to try Claude Code, had just started modding Cyberpunk 2077, and thought building a mod manager for my own setup would be a fun test project. Then the fun part got a little out of hand.

Since then, Hyperion has become the manager I use for my own Cyberpunk 2077 mod list. It grew around the things I wanted day to day: a clean library, clear conflicts, predictable load order, and a launch flow that keeps the game folder under control. After using it privately for a while, I decided to make it public in case it is useful to someone else too.

## Features

- **Full mod library management** — enable/disable per mod or in bulk, group mods with separators, and reorder load priority by drag-and-drop (Mod Organizer–style: higher order wins on shared paths)
- **Virtual deployment (usvfs)** — mods are mapped over the game tree at launch using usvfs, the same User-Space VFS behind Mod Organizer 2. Hyperion avoids full mod deployment into the game folder and keeps the library as the source of truth, with only small runtime bootstrap files staged when needed. Your mod library, downloads folder, and game installation can each live on different drives — an SSD for the game, a large HDD for mods, wherever makes sense
- **Runtime captures** — files written by mod tools during gameplay are captured in Hyperion's managed Overwrite folder and replayed on future launches, keeping the game folder cleaner between sessions
- **Nexus Mods integration** — install via `nxm://` links, automatic update detection scoped to each file's own lineage, and Premium/Free aware download handling
- **FOMOD installer** — full wizard support for conditional installs (body type, textures, options) with image previews
- **Conflict detection** — flags both file-path overwrites and archive-resource conflicts (internal RED4 hash collisions across `.archive` files), with a per-mod win/loss breakdown
- **Archive support** — install from `.zip`, `.rar`, and `.7z`, with live extraction progress and reinstall from the original source at any time
- **Downloads inspection** — browse your downloads folder and inspect archives before installing
- **Launch & monitor** — start Cyberpunk 2077 directly from the app
- **Automatic updates** — delivered through GitHub Releases

## Requirements

- Windows 10 / 11 (64-bit)
- A copy of Cyberpunk 2077

## Nexus API Key

To use Nexus downloads and update checks, Hyperion needs your personal Nexus Mods API key. For now, Hyperion is not an official Nexus Mods application, so you need to paste the key manually:

1. Log in to Nexus Mods and open [API Key Settings](https://www.nexusmods.com/settings/api-keys).
2. Scroll to the bottom of the page.
3. Find **Personal API Key** and copy your personal API key.
4. In Hyperion, open **Settings > Nexus** and paste it there.

![Nexus Mods personal API key location](https://github.com/user-attachments/assets/f215cec2-111e-4aee-a638-518099b53338)

## Download

Get the latest Windows installer from the [Releases](https://github.com/caiovaz567/Hyperion-Mod-Manager/releases/latest) page.

## Building from source

```bash
npm install
npm run dev      # run in development
npm run build    # build a local installer
```

## Demonstrations

<!-- Each item below can be a screenshot, GIF, or MP4 demonstration. Upload the file via a
     GitHub issue (drag-and-drop), then paste the user-attachments URL.
     For MP4, paste the raw URL on its own line; for PNG/GIF use ![alt](url). -->

### FOMOD Installer
Conditional install wizard with image previews — choose body type, textures, and options before anything lands in the library.

![FOMOD installer](https://github.com/user-attachments/assets/3aae9f60-69f4-40bf-8c87-bb9b4b237ba6)

### Conflict Inspector
See exactly which files and archive resources a mod wins or loses against the rest of your load order.

![Conflict inspector](https://github.com/user-attachments/assets/6a87969d-3563-44be-99a2-0b46ebf6cb06)

### Downloads
Browse, search, and install from your downloads folder — with live extraction progress.

![Downloads](https://github.com/user-attachments/assets/40df2af6-d2af-4ef2-b916-269e0be99989)

### Settings
Set your game, mod library, downloads, Nexus integration, update preferences, and diagnostic paths from one place. Each core folder can live on a different drive, and Nexus account settings stay nearby.

![Settings](https://github.com/user-attachments/assets/cc0d870b-43ed-4564-85d5-0cb9a85a691c)

### App Logs
Inspect live diagnostic events from Hyperion. The **General** tab captures launcher, VFS, install, and runtime messages, while **Requests** shows Nexus API request details and payloads for troubleshooting.

![App logs](https://github.com/user-attachments/assets/d2b96bd3-f7f7-4857-8adf-ee70b8978bb3)

## License

Hyperion is free software licensed under the [GNU General Public License v3.0](LICENSE).

Virtual deployment is powered by [usvfs](https://github.com/ModOrganizer2/usvfs) (GPL-3.0, © Sebastian Herbord / Mod Organizer 2 contributors). See [`native/usvfs-bridge/THIRD_PARTY_LICENSES.md`](native/usvfs-bridge/THIRD_PARTY_LICENSES.md) for the full notice.

---

<sub>Hyperion is an unofficial, fan-made tool and is not affiliated with or endorsed by CD PROJEKT RED.</sub>
