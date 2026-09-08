# Third-party components

Hyperion is licensed under the [GNU General Public License v3.0](LICENSE). It
bundles and credits the third-party components listed below. Each is
redistributed unmodified, under its own license, with attribution surfaced in
the application (Settings -> About) and in this document.

---

## usvfs - User-Space Virtual File System

Virtual mod deployment is powered by usvfs, the User-Space VFS developed for
Mod Organizer 2.

> usvfs - User-Space Virtual File System, Copyright (C) Sebastian Herbord

- **Repository:** https://github.com/ModOrganizer2/usvfs
- **License:** GNU General Public License v3.0, with additional permissions
  granted under GPL v3 section 7 for Free and Open Source Software
- **Bundled:** `usvfs_x64.dll`, `usvfs_proxy_x64.exe` (v0.5.7.2, unmodified)

Full notice and license text:
[`native/usvfs-bridge/THIRD_PARTY_LICENSES.md`](native/usvfs-bridge/THIRD_PARTY_LICENSES.md)
and [`native/usvfs-bridge/USVFS-LICENSE.txt`](native/usvfs-bridge/USVFS-LICENSE.txt).

---

## WolvenKit - community resource-hash database

Archive-resource conflict detection reports which internal game resource two
`.archive` files both replace. Turning those hashes into readable resource
paths uses the community hash database maintained by the WolvenKit project.

- **Project:** https://github.com/WolvenKit/WolvenKit
- **License:** GNU General Public License v3.0
- **Bundled:** `hashes.csv.gz` - roughly 1.7 million rows of
  `FNV1a hash, resource path`, covering the base game and Phantom Liberty

This file contains **no game assets and no CD PROJEKT RED content**: only hash
values and the internal resource path strings they resolve to. Hashes that are
not in the database still detect conflicts correctly; they simply display as the
raw hash value.

---

## 7-Zip

Mod archives (`.zip`, `.rar`, `.7z`) are extracted with the 7-Zip command line
binaries, invoked as a separate process.

> 7-Zip Copyright (C) 1999-2026 Igor Pavlov

- **Website:** https://www.7-zip.org/
- **License:** GNU Lesser General Public License. `7z.dll` additionally carries
  the "unRAR license restriction" for part of its code, plus BSD 2-clause and
  BSD 3-clause licensed portions
- **Bundled:** `7z.exe`, `7z.dll` (v26.2.1, unmodified), installed to
  `tools/7zip/` alongside the upstream `License.txt`, which reproduces the full
  license information as that license requires

---

## Runtime dependencies

Electron, React, and the remaining npm packages are redistributed under their
own licenses (MIT, BSD, Apache-2.0 and similar permissive terms). Their license
texts ship inside the installed application and are listed in
`package-lock.json`.
