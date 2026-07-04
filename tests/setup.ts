// Global vitest setup. Electron defines process.resourcesPath; plain node does
// not, and installer.ts reads it at module load (packaged 7-Zip location).
import os from 'os'

if (!process.resourcesPath) {
  Object.defineProperty(process, 'resourcesPath', {
    value: os.tmpdir(),
    configurable: true,
  })
}
