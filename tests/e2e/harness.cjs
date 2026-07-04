// E2E harness entry: boots the real bundled main process inside an ISOLATED
// profile so the test can install/enable/delete mods without ever touching the
// machine's real settings, library, downloads or nxm:// handler registration.
const path = require('path')
const { app } = require('electron')

const profile = process.env.HYPERION_E2E_PROFILE
if (!profile) {
  console.error('[e2e-harness] HYPERION_E2E_PROFILE is not set')
  app.exit(1)
} else {
  app.setPath('userData', path.join(profile, 'userData'))
  app.setPath('sessionData', path.join(profile, 'sessionData'))

  // Dev launches register the nxm:// protocol handler; under test that would
  // re-point the OS handler at this throwaway harness. Make it a no-op.
  app.setAsDefaultProtocolClient = () => false

  require(path.join(__dirname, '..', '..', 'out', 'main', 'index.js'))
}
