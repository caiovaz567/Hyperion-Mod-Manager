import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const [, , releaseType] = process.argv

if (!releaseType || !['patch', 'minor', 'major'].includes(releaseType)) {
  console.error('Usage: node scripts/prepare-release-tag.mjs <patch|minor|major>')
  process.exit(1)
}

const repoRoot = process.cwd()

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()
}

function runNpmVersion(type) {
  const npmExecPath = process.env.npm_execpath

  if (npmExecPath) {
    execFileSync(process.execPath, [npmExecPath, 'version', type, '--no-git-tag-version'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    return
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execFileSync(npmCommand, ['version', type, '--no-git-tag-version'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

const gitDir = runGit(['rev-parse', '--git-dir'])
const pendingTagPath = path.join(repoRoot, gitDir, 'hyperion-pending-tag')

runNpmVersion(releaseType)

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const version = String(packageJson.version ?? '').trim()

if (!version) {
  console.error('Could not read version from package.json after bump.')
  process.exit(1)
}

const tagName = `v${version}`
fs.writeFileSync(pendingTagPath, `${tagName}\n`, 'utf8')

console.log(`Prepared pending release tag ${tagName}.`)
