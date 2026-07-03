// Builds the native usvfs-bridge addon against the project's Electron ABI.
// Cross-platform (no shell-specific $() needed). Skips gracefully off-Windows.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const root = process.cwd()
const moduleDir = path.join(root, 'native', 'usvfs-bridge')

if (process.platform !== 'win32') {
  console.log('[build-native] not Windows - skipping usvfs-bridge build.')
  process.exit(0)
}

if (!existsSync(path.join(moduleDir, 'vendor', 'usvfs_v0.5.7.2', 'lib', 'usvfs_x64.lib'))) {
  console.error(
    '[build-native] usvfs SDK missing under native/usvfs-bridge/vendor.\n' +
      '              Run "npm run fetch:usvfs" first.'
  )
  process.exit(1)
}

const electronVersion = require('electron/package.json').version
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')

console.log(`[build-native] building usvfs-bridge for Electron ${electronVersion} (x64)`)
execFileSync(
  process.execPath,
  [
    nodeGyp,
    'rebuild',
    `--target=${electronVersion}`,
    '--dist-url=https://electronjs.org/headers',
    '--arch=x64',
  ],
  { cwd: moduleDir, stdio: 'inherit' }
)
console.log('[build-native] done.')
