// Fully automated release: bumps the version, rolls the CHANGELOG
// [Unreleased] section into a dated version heading, commits (the post-commit
// hook turns the pending tag into an annotated tag), and pushes with the tag.
//
//   npm run release:patch | release:minor | release:major
//
// Pass --no-push to stop before pushing (commit + tag stay local).
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const releaseType = args.find((a) => ['patch', 'minor', 'major'].includes(a))
const noPush = args.includes('--no-push')

if (!releaseType) {
  console.error('Usage: node scripts/prepare-release-tag.mjs <patch|minor|major> [--no-push]')
  process.exit(1)
}

const repoRoot = process.cwd()

function runGit(gitArgs, opts = {}) {
  // execFileSync returns null when stdout is inherited (e.g. commit/push with
  // stdio: 'inherit'); guard so callers that don't need the output don't crash.
  const out = execFileSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8', ...opts })
  return (out == null ? '' : out).trim()
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
  execFileSync(npmCommand, ['version', type, '--no-git-tag-version'], { cwd: repoRoot, stdio: 'inherit' })
}

// Rolls "## [Unreleased]" into "## [version] - YYYY-MM-DD", leaving a fresh
// empty Unreleased section. Preserves the file's existing line endings.
function rollChangelog(version) {
  const changelogPath = path.join(repoRoot, 'CHANGELOG.md')
  if (!fs.existsSync(changelogPath)) {
    console.warn('[release] CHANGELOG.md not found — skipping changelog roll.')
    return false
  }

  const raw = fs.readFileSync(changelogPath, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const text = raw.replace(/\r\n/g, '\n')

  const marker = '## [Unreleased]'
  const start = text.indexOf(marker)
  if (start === -1) {
    console.warn('[release] No [Unreleased] section — skipping changelog roll.')
    return false
  }

  const afterHeading = start + marker.length
  const sepMatch = /\n---[ \t]*\n/.exec(text.slice(afterHeading))
  if (!sepMatch) {
    console.warn('[release] No separator after [Unreleased] — skipping changelog roll.')
    return false
  }

  const body = text.slice(afterHeading, afterHeading + sepMatch.index).trim()
  const rest = text.slice(afterHeading + sepMatch.index + sepMatch[0].length)
  const date = new Date().toISOString().slice(0, 10)
  const bodyBlock = body ? `\n${body}\n` : ''

  const out =
    text.slice(0, start) +
    `## [Unreleased]\n\n---\n\n## [${version}] - ${date}\n${bodyBlock}\n---\n` +
    rest

  fs.writeFileSync(changelogPath, out.replace(/\n/g, eol), 'utf8')
  if (!body) console.warn('[release] Note: [Unreleased] had no entries.')
  return true
}

// 1) Bump version (updates package.json + package-lock.json)
runNpmVersion(releaseType)

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const version = String(packageJson.version ?? '').trim()
if (!version) {
  console.error('[release] Could not read version from package.json after bump.')
  process.exit(1)
}
const tagName = `v${version}`

// 2) Arm the pending tag the post-commit hook will create
const gitDir = runGit(['rev-parse', '--git-dir'])
fs.writeFileSync(path.join(repoRoot, gitDir, 'hyperion-pending-tag'), `${tagName}\n`, 'utf8')

// 3) Roll the changelog
rollChangelog(version)

// 4) Commit only the release files (post-commit hook creates the annotated tag)
const files = ['package.json', 'package-lock.json', 'CHANGELOG.md'].filter((f) =>
  fs.existsSync(path.join(repoRoot, f)),
)
runGit(['add', ...files])
runGit(['commit', '-m', `chore(release): bump version to ${version}`, '--', ...files], { stdio: 'inherit' })
console.log(`[release] Committed release ${tagName} and created its tag.`)

// 5) Push commit + tag
if (noPush) {
  console.log('[release] --no-push set. Push manually with: git push --follow-tags')
  process.exit(0)
}

const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'])
try {
  runGit(['push', '--follow-tags', 'origin', branch], { stdio: 'inherit' })
  console.log(`[release] Pushed ${branch} with ${tagName}. The Release workflow will build and publish.`)
} catch {
  console.error(`[release] Push failed. Commit + tag are local — push manually:\n    git push --follow-tags origin ${branch}`)
  process.exit(1)
}
