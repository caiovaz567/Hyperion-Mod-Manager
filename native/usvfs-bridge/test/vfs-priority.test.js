// Phase 3a: multiple library files virtually mapped over a fake game tree, with
// load-order priority (higher mod overrides) and virtual directory enumeration.
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const LOG = process.env.PHASE3A_LOG || path.join(__dirname, 'phase3a-result.txt')

function run() {
  const result = {}
  const bridge = require(path.join(__dirname, '..', 'build', 'Release', 'usvfs_bridge.node'))

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-vfs3-'))
  const gameModDir = path.join(root, 'game', 'archive', 'pc', 'mod')
  fs.mkdirSync(gameModDir, { recursive: true })

  // two "mods" in a library, each holding one file
  const libLow = path.join(root, 'lib', 'modLow')
  const libHigh = path.join(root, 'lib', 'modHigh')
  fs.mkdirSync(libLow, { recursive: true })
  fs.mkdirSync(libHigh, { recursive: true })
  fs.writeFileSync(path.join(libLow, 'shared.archive'), 'LOW')
  fs.writeFileSync(path.join(libHigh, 'shared.archive'), 'HIGH')
  fs.writeFileSync(path.join(libHigh, 'highonly.archive'), 'HIGHONLY')

  const sharedDest = path.join(gameModDir, 'shared.archive')
  const highOnlyDest = path.join(gameModDir, 'highonly.archive')

  // links in load order: low first, high last → high overrides shared
  const links = [
    { source: path.join(libLow, 'shared.archive'), dest: sharedDest },
    { source: path.join(libHigh, 'shared.archive'), dest: sharedDest },
    { source: path.join(libHigh, 'highonly.archive'), dest: highOnlyDest },
  ]

  result.mount = bridge.mountVfs({ instanceName: 'hyperion_phase3a', links })

  const comspec = process.env.ComSpec || 'cmd.exe'
  const typeShared = bridge.launchHookedProcess({
    appPath: comspec,
    commandLine: `"${comspec}" /c type "${sharedDest}"`,
    capture: true,
    waitMs: 15000,
  })
  const typeHighOnly = bridge.launchHookedProcess({
    appPath: comspec,
    commandLine: `"${comspec}" /c type "${highOnlyDest}"`,
    capture: true,
    waitMs: 15000,
  })
  const dirList = bridge.launchHookedProcess({
    appPath: comspec,
    commandLine: `"${comspec}" /c dir /b "${gameModDir}"`,
    capture: true,
    waitMs: 15000,
  })

  bridge.unmountVfs()

  result.sharedContent = (typeShared.stdout || '').trim()
  result.highOnlyContent = (typeHighOnly.stdout || '').trim()
  result.dirListing = (dirList.stdout || '').trim().split(/\r?\n/).filter(Boolean)

  // real disk must NOT contain the virtual files
  result.sharedOnDisk = fs.existsSync(sharedDest)
  result.highOnlyOnDisk = fs.existsSync(highOnlyDest)

  result.verdict =
    result.sharedContent === 'HIGH' &&
    result.highOnlyContent === 'HIGHONLY' &&
    result.dirListing.includes('shared.archive') &&
    result.dirListing.includes('highonly.archive') &&
    !result.sharedOnDisk &&
    !result.highOnlyOnDisk
      ? 'PHASE 3a OK'
      : 'PHASE 3a FAILED'

  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
  return result
}

app.whenReady().then(() => {
  let result
  try {
    result = run()
  } catch (e) {
    result = { verdict: 'PHASE 3a ERROR', error: e && e.message ? e.message : String(e) }
  }
  fs.writeFileSync(LOG, JSON.stringify(result, null, 2))
  app.quit()
})
