import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = process.cwd()

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const gitDir = runGit(['rev-parse', '--git-dir'])
const pendingTagPath = path.join(repoRoot, gitDir, 'hyperion-pending-tag')

if (!fs.existsSync(pendingTagPath)) {
  process.exit(0)
}

const tagName = fs.readFileSync(pendingTagPath, 'utf8').trim()
fs.rmSync(pendingTagPath, { force: true })

if (!tagName) {
  process.exit(0)
}

const existingTag = runGit(['tag', '--list', tagName])
if (existingTag) {
  execFileSync('git', ['tag', '-d', tagName], { cwd: repoRoot, stdio: 'ignore' })
}

execFileSync('git', ['tag', '-a', tagName, '-m', tagName], {
  cwd: repoRoot,
  stdio: 'ignore',
})
