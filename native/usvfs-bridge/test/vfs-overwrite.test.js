// Write-redirection (overwrite layer) validation — faithfully mirrors the real
// Cyberpunk launch tree that broke RED4ext:
//
//   game root        -> createTarget -> vfs-overwrite   (write redirect)
//   game/bin/x64/... -> child mount  -> CET mod          (bin/x64/plugins EXISTS physically in game)
//   game/red4ext     -> child mount  -> RED4ext mod      (red4ext does NOT exist physically in game)
//
// Two runtime writes must both be redirected into the overwrite folder:
//   A) red4ext/logs/red4ext.log     — parent (red4ext/) is VIRTUAL-ONLY  -> real RED4ext crash case
//   B) bin/x64/plugins/address_library/al.bin — parent EXISTS physically -> the address_library leak case
//
// Neither may land in the real game root, neither may leak back into a mod, and
// mod reads must still work. A mount -> unmount -> re-mount cycle must not crash.
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const LOG = process.env.OVERWRITE_LOG || path.join(__dirname, 'overwrite-result.txt')

function listTree(root) {
  const out = []
  const walk = (dir, rel) => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), r)
      else out.push(r)
    }
  }
  walk(root, '')
  return out.sort()
}

function run() {
  const result = {}
  const bridge = require(path.join(__dirname, '..', 'build', 'Release', 'usvfs_bridge.node'))
  result.usvfsVersion = bridge.usvfsVersion()

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-overwrite-'))

  // Real game root: bin/x64/plugins EXISTS physically (CP2077 ships it); NO red4ext/.
  const gameRoot = path.join(root, 'game')
  fs.mkdirSync(path.join(gameRoot, 'bin', 'x64', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(gameRoot, 'bin', 'x64', 'Cyberpunk2077.exe'), 'EXE')

  // CET-like mod providing bin/x64 content.
  const cetMod = path.join(root, 'lib', 'CET')
  fs.mkdirSync(path.join(cetMod, 'bin', 'x64', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(cetMod, 'bin', 'x64', 'version.dll'), 'VERSIONDLL')
  fs.writeFileSync(path.join(cetMod, 'bin', 'x64', 'plugins', 'cet.asi'), 'CETASI')

  // RED4ext-like mod providing red4ext/ (virtual-only over the game).
  const r4Mod = path.join(root, 'lib', 'RED4ext')
  fs.mkdirSync(path.join(r4Mod, 'red4ext', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(r4Mod, 'red4ext', 'RED4ext.dll'), 'RED4EXTDLL')

  const overwriteDir = path.join(root, 'overwrite')
  fs.mkdirSync(overwriteDir, { recursive: true })

  // Same link order the app builds: mod dir mounts first, overwrite LAST.
  const links = [
    { source: path.join(cetMod, 'bin'), dest: path.join(gameRoot, 'bin'), dir: true },
    { source: path.join(r4Mod, 'red4ext'), dest: path.join(gameRoot, 'red4ext'), dir: true },
    { source: overwriteDir, dest: gameRoot, dir: true, createTarget: true },
  ]

  result.mount = bridge.mountVfs({ instanceName: 'hyperion_overwrite', links })

  const comspec = process.env.ComSpec || 'cmd.exe'

  // Case A: nested write under a VIRTUAL-ONLY parent (the RED4ext crash case).
  const logsDir = path.join(gameRoot, 'red4ext', 'logs')
  const logFile = path.join(logsDir, 'red4ext.log')
  // Case B: nested write under a PHYSICALLY-EXISTING parent (the address_library leak case).
  const alDir = path.join(gameRoot, 'bin', 'x64', 'plugins', 'address_library')
  const alFile = path.join(alDir, 'al.bin')

  const writeOps = bridge.launchHookedProcess({
    appPath: comspec,
    commandLine:
      `"${comspec}" /c ` +
      `mkdir "${logsDir}" && echo logline> "${logFile}" && ` +
      `mkdir "${alDir}" && echo albin> "${alFile}" && ` +
      `echo OK_WRITE`,
    capture: true,
    waitMs: 20000,
  })
  result.writeStdout = (writeOps.stdout || '').trim()

  // Case C: replicate RED4ext's actual API — std::filesystem::create_directories
  // (recursive, stat-then-create per level) + ofstream — via .NET, which lowers
  // to the same CreateDirectoryW/CreateFileW pattern. cmd's mkdir may differ.
  const psLogsDir = path.join(gameRoot, 'red4ext', 'logs2')
  const psLogFile = path.join(psLogsDir, 'red4ext.log')
  const psScript =
    `[System.IO.Directory]::CreateDirectory('${psLogsDir.replace(/\\/g, '\\\\')}') > $null; ` +
    `[System.IO.File]::WriteAllText('${psLogFile.replace(/\\/g, '\\\\')}', 'psline'); ` +
    `Write-Output OK_PS`
  const psOps = bridge.launchHookedProcess({
    appPath: process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe',
    commandLine: `powershell -NoProfile -NonInteractive -Command "${psScript}"`,
    capture: true,
    waitMs: 25000,
  })
  result.psStdout = (psOps.stdout || '').trim()

  // Reads of mod files must still work through the virtual paths.
  const readMod = bridge.launchHookedProcess({
    appPath: comspec,
    commandLine: `"${comspec}" /c type "${path.join(gameRoot, 'red4ext', 'RED4ext.dll')}"`,
    capture: true,
    waitMs: 15000,
  })
  result.modContent = (readMod.stdout || '').trim()

  // Stability: a second mount/unmount cycle must not crash.
  bridge.unmountVfs()
  result.remount = bridge.mountVfs({ instanceName: 'hyperion_overwrite', links })
  bridge.unmountVfs()

  result.gameRootTree = listTree(gameRoot)
  result.overwriteTree = listTree(overwriteDir)
  result.cetModTree = listTree(cetMod)
  result.r4ModTree = listTree(r4Mod)

  result.checks = {
    writeSucceeded: result.writeStdout.includes('OK_WRITE'),
    psWriteSucceeded: result.psStdout.includes('OK_PS'),
    modStillReadable: result.modContent === 'RED4EXTDLL',
    // C) .NET create_directories path redirected to overwrite (RED4ext's real API)
    psLogInOverwrite: result.overwriteTree.includes('red4ext/logs2/red4ext.log'),
    noPsLogInGame: !result.gameRootTree.some((p) => p.startsWith('red4ext/')),
    // A) red4ext/logs write redirected to overwrite (the crash case)
    red4extLogInOverwrite: result.overwriteTree.includes('red4ext/logs/red4ext.log'),
    // B) address_library write redirected to overwrite (the leak case)
    addressLibInOverwrite: result.overwriteTree.includes('bin/x64/plugins/address_library/al.bin'),
    // real game folder must stay clean of BOTH runtime writes
    noRed4extInGame: !result.gameRootTree.some((p) => p.startsWith('red4ext/')),
    noAddressLibInGame: !result.gameRootTree.includes('bin/x64/plugins/address_library/al.bin'),
    // mods stay pristine
    modsClean:
      !result.cetModTree.some((p) => p.includes('address_library')) &&
      !result.r4ModTree.some((p) => p.includes('logs')),
    remountOk: !!(result.remount && result.remount.ok),
  }

  result.verdict = Object.values(result.checks).every(Boolean)
    ? 'OVERWRITE OK'
    : 'OVERWRITE FAILED'

  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
  return result
}

app.whenReady().then(() => {
  let result
  try {
    result = run()
  } catch (e) {
    result = { verdict: 'OVERWRITE ERROR', error: e && e.message ? e.message : String(e) }
  }
  fs.writeFileSync(LOG, JSON.stringify(result, null, 2))
  app.quit()
})
