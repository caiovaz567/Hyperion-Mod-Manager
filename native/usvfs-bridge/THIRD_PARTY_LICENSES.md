# Third-party components

## usvfs — User-Space Virtual File System

Hyperion bundles **unmodified** binary copies of usvfs (`usvfs_x64.dll`,
`usvfs_proxy_x64.exe`) and links against it for virtual mod deployment.

> usvfs - User-Space Virtual File System, Copyright (C) Sebastian Herbord

- **Version bundled:** v0.5.7.2 (official release, unmodified)
- **Source / repository:** https://github.com/ModOrganizer2/usvfs
- **License:** GNU General Public License v3.0, with additional permissions
  granted under GPL v3 section 7 for Free and Open Source Software. A full copy
  of the license is included alongside this file as
  [`USVFS-LICENSE.txt`](./USVFS-LICENSE.txt).

usvfs grants FOSS software permission to link with `usvfs_x64.dll` and to
distribute unmodified binary copies, provided the software (1) is distributed
under a FOSS/OSI license, (2) includes the copyright notice above, a copy of the
license, and a link to the usvfs repository in its user interface and user-facing
documentation, and (3) is not linked or distributed with proprietary (non-FOSS)
software.

Hyperion is licensed under the GNU General Public License v3.0 and ships no
proprietary components, satisfying these conditions. The same attribution is
surfaced in the application's UI (Settings → About) and user-facing
documentation.
