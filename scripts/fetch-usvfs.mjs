// Downloads the pinned, unmodified usvfs release and extracts its SDK into
// native/usvfs-bridge/vendor (gitignored). Verifies the SHA-256 so the build is
// reproducible. usvfs is GPL-3.0 (+ section-7 FOSS permission) — see
// native/usvfs-bridge/THIRD_PARTY_LICENSES.md.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)

const USVFS_VERSION = 'v0.5.7.2'
const ASSET = `usvfs_${USVFS_VERSION}.7z`
const URL = `https://github.com/ModOrganizer2/usvfs/releases/download/${USVFS_VERSION}/${ASSET}`
const SHA256 = 'c6252eed78ee1c307733a4412cb68522cffc48107be4795c4e38b2b8d7c76d01'

const root = process.cwd()
const vendorDir = path.join(root, 'native', 'usvfs-bridge', 'vendor')
const archivePath = path.join(vendorDir, ASSET)
const extractDir = path.join(vendorDir, `usvfs_${USVFS_VERSION}`)

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

async function main() {
  if (existsSync(path.join(extractDir, 'lib', 'usvfs_x64.lib'))) {
    console.log(`[fetch-usvfs] already present: ${extractDir}`)
    return
  }
  mkdirSync(vendorDir, { recursive: true })

  if (!existsSync(archivePath) || sha256(archivePath) !== SHA256) {
    console.log(`[fetch-usvfs] downloading ${URL}`)
    const res = await fetch(URL)
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
    writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()))
  }

  const actual = sha256(archivePath)
  if (actual !== SHA256) {
    throw new Error(`SHA-256 mismatch!\n expected ${SHA256}\n actual   ${actual}`)
  }
  console.log('[fetch-usvfs] sha256 verified')

  const sevenZip = require('7zip-bin-full').path7za ?? path.join(
    root, 'node_modules', '7zip-bin-full', 'win', 'x64', '7z.exe'
  )
  console.log('[fetch-usvfs] extracting...')
  execFileSync(sevenZip, ['x', '-y', `-o${extractDir}`, archivePath], { stdio: 'inherit' })
  console.log(`[fetch-usvfs] done: ${extractDir}`)
}

main().catch((err) => {
  console.error('[fetch-usvfs]', err.message)
  process.exit(1)
})
