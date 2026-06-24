// Phase 2b checkpoint: mount a VFS, virtually link a real file to a path that
// does NOT exist on disk, and prove a hooked process can read it while the real
// disk and a non-hooked process cannot.
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const LOG = process.env.PHASE2B_LOG || path.join(__dirname, 'phase2b-result.txt')

function run() {
  const result = {}
  try {
    const bridge = require(path.join(__dirname, '..', 'build', 'Release', 'usvfs_bridge.node'))

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-vfs-'))
    const source = path.join(dir, 'real_source.txt')
    const dest = path.join(dir, 'virtual_only.txt')
    const marker = 'HYPERION_VFS_MARKER_' + Date.now()
    fs.writeFileSync(source, marker)

    result.destExistsOnDiskBefore = fs.existsSync(dest)

    // (a) hooked read through the VFS
    const probe = bridge.runVfsProbe(source, dest)
    result.probe = probe
    result.hookedSawMarker = !!(probe.ok && probe.stdout && probe.stdout.includes(marker))

    // disk still has no such file
    result.destExistsOnDiskAfter = fs.existsSync(dest)

    // (b) non-hooked read must fail (file genuinely not on disk)
    try {
      execFileSync('cmd.exe', ['/c', 'type', dest], { stdio: 'pipe' })
      result.nonHookedFailed = false
    } catch {
      result.nonHookedFailed = true
    }

    result.verdict =
      result.hookedSawMarker &&
      !result.destExistsOnDiskBefore &&
      !result.destExistsOnDiskAfter &&
      result.nonHookedFailed
        ? 'PHASE 2b OK'
        : 'PHASE 2b FAILED'

    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  } catch (e) {
    result.error = e && e.message ? e.message : String(e)
    result.verdict = 'PHASE 2b ERROR'
  }
  return result
}

app.whenReady().then(() => {
  const result = run()
  fs.writeFileSync(LOG, JSON.stringify(result, null, 2))
  app.quit()
})
