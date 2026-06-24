// When are usvfs file hooks active relative to a statically-imported DLL's
// DllMain? probe.dll is loaded PHYSICALLY (so it loads at all), but its DllMain
// reads a virtual-only file and creates a virtual-only nested dir — exactly what
// RED4ext's winmm.dll does during early init. The output file tells us whether
// usvfs redirection is live during DllMain.
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const LOG = process.env.DLLMAIN_LOG || path.join(__dirname, 'dllmain-result.txt')
const PROBE_DIR =
  process.env.PROBE_DIR ||
  path.join(
    'C:', 'Users', 'caiom', 'AppData', 'Local', 'Temp', 'claude',
    'h--Fenix-Project', '02c77a4f-2a0e-417a-ab3f-9ed5fafbf456', 'scratchpad', 'probe'
  )

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
  const result = { probeDir: PROBE_DIR }
  const bridge = require(path.join(__dirname, '..', 'build', 'Release', 'usvfs_bridge.node'))

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-dllmain-'))
  const gameBinX64 = path.join(root, 'game', 'bin', 'x64')
  fs.mkdirSync(gameBinX64, { recursive: true })
  // probe.exe + probe.dll BOTH physical (staged) so the EXE starts and DllMain runs.
  fs.copyFileSync(path.join(PROBE_DIR, 'probe.exe'), path.join(gameBinX64, 'probe.exe'))
  fs.copyFileSync(path.join(PROBE_DIR, 'probe.dll'), path.join(gameBinX64, 'probe.dll'))

  // A mod provides a virtual-only config file and a virtual-only red4ext/ tree.
  const mod = path.join(root, 'mod')
  fs.mkdirSync(path.join(mod, 'red4ext'), { recursive: true })
  fs.writeFileSync(path.join(mod, 'secret.txt'), 'VSECRET')
  fs.writeFileSync(path.join(mod, 'red4ext', 'RED4ext.dll'), 'R4')

  // THE FIX under test: physically stage the RED4ext framework tree into the
  // game so its DllMain (which runs before usvfs hooks) can create red4ext/logs
  // on real disk. Set HYPERION_PROBE_STAGE_RED4EXT=0 to test the broken (virtual)
  // baseline instead.
  const stageRed4ext = process.env.HYPERION_PROBE_STAGE_RED4EXT !== '0'
  if (stageRed4ext) {
    fs.mkdirSync(path.join(root, 'game', 'red4ext'), { recursive: true })
    fs.copyFileSync(path.join(mod, 'red4ext', 'RED4ext.dll'),
      path.join(root, 'game', 'red4ext', 'RED4ext.dll'))
  }

  const overwrite = path.join(root, 'overwrite')
  fs.mkdirSync(overwrite, { recursive: true })

  const gameRoot = path.join(root, 'game')
  const links = [
    { source: path.join(mod, 'secret.txt'), dest: path.join(gameRoot, 'secret.txt') },
    { source: path.join(mod, 'red4ext'), dest: path.join(gameRoot, 'red4ext'), dir: true },
    { source: overwrite, dest: gameRoot, dir: true, createTarget: true },
  ]
  result.mount = bridge.mountVfs({ instanceName: 'hyperion_dllmain', links })

  const outFile = path.join(root, 'dllmain-out.txt')
  // Env is inherited by the hooked child (addon passes lpEnvironment = NULL).
  process.env.HYPERION_PROBE_OUT = outFile
  process.env.HYPERION_PROBE_VFILE = path.join(gameRoot, 'secret.txt')
  process.env.HYPERION_PROBE_VDIR = path.join(gameRoot, 'red4ext', 'logs')

  const exe = path.join(gameBinX64, 'probe.exe')
  const launch = bridge.launchHookedProcess({
    appPath: exe, commandLine: `"${exe}"`, cwd: gameBinX64, capture: true, waitMs: 20000,
  })
  bridge.unmountVfs()

  result.exeStdout = (launch && launch.stdout ? launch.stdout : '').trim()
  result.dllmainOut = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').trim() : '(no output)'
  result.overwriteTree = listTree(overwrite)
  result.gameTree = listTree(gameRoot).filter((p) => !p.startsWith('bin/')) // ignore staged exe/dll

  const out = result.dllmainOut
  result.findings = {
    exeRan: result.exeStdout.includes('PROBE=4242'),
    // hooks active during DllMain if the virtual-only file was readable
    readHookLiveInDllMain: out.includes('DLLMAIN_VREAD=VSECRET'),
    // write-redirect active during DllMain if the dir create succeeded AND landed in overwrite
    writeHookLiveInDllMain:
      out.includes('DLLMAIN_VDIR=CREATE_OK') &&
      result.overwriteTree.includes('red4ext/logs/probe.log'),
    // the real RED4ext symptom: dir create fails because parent is virtual-only
    reproducedRed4extFailure: /DLLMAIN_VDIR=(MKDIR_FAIL|LOGFILE_FAIL)/.test(out),
    leakedToGame: result.gameTree.some((p) => p.startsWith('red4ext/')),
  }

  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
  return result
}

app.whenReady().then(() => {
  let result
  try { result = run() }
  catch (e) { result = { error: e && e.message ? e.message : String(e) } }
  fs.writeFileSync(LOG, JSON.stringify(result, null, 2))
  app.quit()
})
