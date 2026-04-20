import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function tryRunGit(args) {
  try {
    return runGit(args)
  } catch {
    return null
  }
}

const gitDir = tryRunGit(['rev-parse', '--git-dir'])
if (!gitDir) {
  console.log('Skipping git hook setup: not inside a git repository.')
  process.exit(0)
}

const hooksPath = '.githooks'
const postCommitPath = path.join(repoRoot, hooksPath, 'post-commit')

if (!fs.existsSync(postCommitPath)) {
  console.log('Skipping git hook setup: .githooks/post-commit not found.')
  process.exit(0)
}

runGit(['config', '--local', 'core.hooksPath', hooksPath])
runGit(['config', '--local', 'push.followTags', 'true'])

console.log('Configured local git hooks and automatic tag pushing for this repository.')
