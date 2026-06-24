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

<!--
MEDIA — HERO SHOT (Mod Library, PNG)
1. Open a new issue on the repo (you don't even have to submit it).
2. Drag library.png into the comment box; GitHub uploads it.
3. Copy the generated https://github.com/user-attachments/assets/... URL and paste it below.
-->
<p align="center">
  <img src="https://github.com/user-attachments/assets/fa6222aa-1835-46fb-a1a2-f3cc91a6638b" alt="Hyperion mod library" width="900" />
</p>

## Features

- **Full mod library management** — enable/disable per mod or in bulk, group mods with separators, and reorder load priority by drag-and-drop (Mod Organizer–style: higher order wins on shared paths)
- **Symlink deployment** — mods deploy to the game as NTFS file symlinks instead of copies, so installing and toggling mods is instant and doesn't duplicate gigabytes of files
- **Nexus Mods integration** — install via `nxm://` links, automatic update detection scoped to each file's own lineage, and Premium/Free aware download handling
- **FOMOD installer** — full wizard support for conditional installs (body type, textures, options) with image previews
- **Conflict detection** — flags both file-path overwrites and archive-resource conflicts (internal RED4 hash collisions across `.archive` files), with a per-mod win/loss breakdown
- **Archive support** — install from `.zip`, `.rar`, and `.7z`, with live extraction progress and reinstall from the original source at any time
- **Downloads inspection** — browse your downloads folder and inspect archives before installing
- **Launch & monitor** — start Cyberpunk 2077 directly from the app
- **Automatic updates** — delivered through GitHub Releases

## Screenshots

<!--
For each item below: upload the file via a GitHub issue (see the hero note above),
then replace the PASTE_..._URL_HERE placeholder with the user-attachments URL.

TIP: For the animated flows (install, FOMOD), upload an MP4 instead of a GIF —
it's much smaller and GitHub renders it inline. To embed an MP4, just paste the
raw user-attachments URL on its own line (no Markdown image syntax needed):

  https://github.com/user-attachments/assets/xxxxxxxx

For PNG/GIF, use the ![alt](url) syntax shown below.
-->

### Download → extract → install

One click pulls the archive, unpacks it, and deploys it — with live progress.

![Install flow](PASTE_INSTALL_GIF_OR_MP4_URL_HERE)

### FOMOD installer

Conditional install options with image previews, just like on Nexus.

![FOMOD installer](PASTE_FOMOD_URL_HERE)

### Conflict inspector

See exactly which files and archive resources a mod wins or loses.

![Conflict inspector](PASTE_CONFLICT_URL_HERE)

## Requirements

- Windows 10 / 11 (64-bit)
- A copy of Cyberpunk 2077
- Administrator privileges (required so Windows grants the symlink permission used for deployment — the installer requests this automatically)

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

---

<sub>Hyperion is an unofficial, fan-made tool and is not affiliated with or endorsed by CD PROJEKT RED.</sub>
