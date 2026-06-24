// Import-time DLL resolution through usvfs — the decisive test for whether
// Hyperion needs to physically stage loader DLLs (version.dll/winmm.dll/.asi)
// into the game's bin/x64, or whether pure VFS suffices (like MO2).
//
// probe.exe STATICALLY imports probe.dll, so Windows must resolve probe.dll at
// process initialization — before main runs. We place probe.exe in a fake game
// bin/x64 with NO probe.dll physically beside it, and mount probe.dll there only
// virtually. If the hooked process prints PROBE=4242, import-time resolution
// works virtually and staging is unnecessary.
//
// Control: launching the same EXE WITHOUT usvfs (plain spawn, no physical DLL)
// must fail to start (missing DLL) — proving the DLL is genuinely needed/absent.
const { app } = require('electron')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const LOG = process.env.IMPORTDLL_LOG || path.join(__dirname, 'importdll-result.txt')
const PROBE_DIR =
  process.env.PROBE_DIR ||
  path.join(
    'C:', 'Users', 'caiom', 'AppData', 'Local', 'Temp', 'claude',
    'h--Fenix-Project', '02c77a4f-2a0e-417a-ab3f-9ed5fafbf456', 'scratchpad', 'probe'
  )

function run() {
  const result = { probeDir: PROBE_DIR }
  const bridge = require(path.join(__dirname, '..', 'build', 'Release', 'usvfs_bridge.node'))

  const srcExe = path.join(PROBE_DIR, 'probe.exe')
  const srcDll = path.join(PROBE_DIR, 'probe.dll')
  result.srcExists = fs.existsSync(srcExe) && fs.existsSync(srcDll)

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-importdll-'))
  // Fake game: bin/x64 holds the EXE only — NO probe.dll physically.
  const gameBinX64 = path.join(root, 'game', 'bin', 'x64')
  fs.mkdirSync(gameBinX64, { recursive: true })
  const gameExe = path.join(gameBinX64, 'probe.exe')
  fs.copyFileSync(srcExe, gameExe)

  // Mod ships probe.dll into bin/x64 (the import-time loader case).
  const modBinX64 = path.join(root, 'mod', 'bin', 'x64')
  fs.mkdirSync(modBinX64, { recursive: true })
  fs.copyFileSync(srcDll, path.join(modBinX64, 'probe.dll'))

  // CONTROL: plain spawn, cwd has no probe.dll, app dir has no probe.dll.
  // Expect failure to start (exit code 0xC0000135 STATUS_DLL_NOT_FOUND = -1073741515).
  const control = spawnSync(gameExe, [], { cwd: gameBinX64, encoding: 'utf8', windowsHide: true })
  result.control = {
    status: control.status,
    stdout: (control.stdout || '').trim(),
    // a missing import DLL makes the process fail to initialize
    failedToStart: control.status !== 0,
  }

  const virtualDll = path.join(gameBinX64, 'probe.dll') // virtual path inside the game tree
  const links = [
    { source: path.join(root, 'mod', 'bin'), dest: path.join(root, 'game', 'bin'), dir: true },
  ]

  // TEST 1: plain hooked launch (no force-load). Expected to FAIL — the loader
  // resolves the EXE's static imports before usvfs hooks are active.
  result.mount = bridge.mountVfs({ instanceName: 'hyperion_importdll', links })
  const plain = bridge.launchHookedProcess({
    appPath: gameExe, commandLine: `"${gameExe}"`, cwd: gameBinX64, capture: true, waitMs: 20000,
  })
  result.hookedPlain = {
    exitCode: plain && plain.exitCode,
    stdout: (plain && plain.stdout ? plain.stdout : '').trim(),
  }
  bridge.unmountVfs()

  // TEST 2: force-load the virtual probe.dll before launching. usvfs loads it
  // through the VFS while hooks are active, so the static import binds to it.
  result.mount2 = bridge.mountVfs({ instanceName: 'hyperion_importdll', links })
  result.forceLoad = bridge.forceLoadLibrary('probe.exe', virtualDll)
  const forced = bridge.launchHookedProcess({
    appPath: gameExe, commandLine: `"${gameExe}"`, cwd: gameBinX64, capture: true, waitMs: 20000,
  })
  result.hookedForced = {
    exitCode: forced && forced.exitCode,
    stdout: (forced && forced.stdout ? forced.stdout : '').trim(),
  }
  bridge.unmountVfs()

  // The DLL must NOT have leaked physically into the game dir.
  result.dllLeakedToGame = fs.existsSync(path.join(gameBinX64, 'probe.dll'))

  result.checks = {
    srcBuilt: result.srcExists,
    controlFailsWithoutDll: result.control.failedToStart && !result.control.stdout.includes('PROBE='),
    plainHookFailsAsExpected: !result.hookedPlain.stdout.includes('PROBE='),
    forceLoadResolvesVirtualDll: result.hookedForced.stdout.includes('PROBE=4242'),
    noPhysicalLeak: !result.dllLeakedToGame,
  }
  result.verdict = Object.values(result.checks).every(Boolean)
    ? 'IMPORT-DLL OK (forceLoadLibrary resolves import-time DLLs virtually; no staging, no admin)'
    : 'IMPORT-DLL FAILED'

  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
  return result
}

app.whenReady().then(() => {
  let result
  try {
    result = run()
  } catch (e) {
    result = { verdict: 'IMPORT-DLL ERROR', error: e && e.message ? e.message : String(e) }
  }
  fs.writeFileSync(LOG, JSON.stringify(result, null, 2))
  app.quit()
})
