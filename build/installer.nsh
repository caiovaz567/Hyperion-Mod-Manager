!macro customInstallMode
  StrCpy $isForceMachineInstall "0"
  StrCpy $isForceCurrentInstall "1"
!macroend

# Surgical uninstall: remove only Hyperion's own files instead of the default
# `RMDir /r $INSTDIR`, which would also delete the suggested `Mods` / `Downloads`
# folders (and any other user content) that live inside the install directory.
# This macro is used by both manual uninstall and auto-update (electron-builder runs
# the previous version's uninstaller during an update), so any install of this version
# onward keeps user data safe across updates and uninstalls.
#
# build/uninstall-files.nsh is generated at build time by scripts/after-pack.cjs and
# defines `hyperionRemoveOwnedFiles` (the exact packed footprint). The include MUST be at
# top level (not inside the macro below) — NSIS forbids defining a macro inside a macro.
# /NONFATAL keeps a clean checkout compiling before a build has generated the manifest;
# if it is ever missing, we simply remove nothing extra and never touch user data.
!include /NONFATAL "${BUILD_RESOURCES_DIR}\uninstall-files.nsh"

!macro customRemoveFiles
  !ifmacrodef hyperionRemoveOwnedFiles
    !insertmacro hyperionRemoveOwnedFiles
  !endif
  # Files that exist in the install dir but not in the packed output.
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  Delete "$INSTDIR\uninstallerIcon.ico"
  # Remove the install directory only if it is now empty — user folders such as
  # Mods, Downloads, or anything else the user created keep it populated and survive.
  RMDir "$INSTDIR"
!macroend