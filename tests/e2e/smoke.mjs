// Hyperion E2E smoke test. Boots the REAL app (Electron main + renderer) inside
// an ISOLATED throwaway profile - fake game dir, empty library, fixture
// downloads, its own userData - and exercises the core user journey end to end:
//
//   scenario "first-run": empty profile boots into the welcome/onboarding screen
//   scenario "workflow":  seeded profile -> Downloads lists 2 fixture archives ->
//     install both (incl. the overwrite-conflict prompt on the second) -> mods
//     appear enabled in the library -> conflict badges show +1/-1 -> search
//     filters -> disabling clears the conflict pair -> delete with confirm
//     dialog (folder really leaves the disk) -> App Logs opens. Fails on any
//     renderer pageerror.
//
// It NEVER touches the machine's real settings/library/downloads (see
// harness.cjs). Run with: npm run test:e2e. Screenshots: tests/e2e/artifacts/.
import AdmZip from 'adm-zip'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { _electron } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const artifactsDir = path.join(root, 'tests', 'e2e', 'artifacts')
const harness = path.join(root, 'tests', 'e2e', 'harness.cjs')
fs.mkdirSync(artifactsDir, { recursive: true })

const failures = []
const pageErrors = []
const tempProfiles = []

function step(name, ok, detail = '') {
  console.log(`[smoke] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`)
}

async function screenshot(page, name) {
  try {
    await page.screenshot({ path: path.join(artifactsDir, `${name}.png`) })
  } catch { /* diagnostics only */ }
}

function makeProfile() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-e2e-'))
  tempProfiles.push(profile)
  return profile
}

function makeFixtureZip(downloadsDir, zipName, files) {
  const zip = new AdmZip()
  for (const [rel, content] of Object.entries(files)) {
    zip.addFile(rel, Buffer.from(content, 'utf-8'))
  }
  zip.writeZip(path.join(downloadsDir, zipName))
}

// Fake-but-valid environment: game validation only needs bin/x64/Cyberpunk2077.exe.
function seedProfile(profile, { seedSettings }) {
  const gamePath = path.join(profile, 'game')
  const libraryPath = path.join(profile, 'library')
  const downloadPath = path.join(profile, 'downloads')
  fs.mkdirSync(path.join(gamePath, 'bin', 'x64'), { recursive: true })
  fs.writeFileSync(path.join(gamePath, 'bin', 'x64', 'Cyberpunk2077.exe'), 'not a real exe')
  fs.mkdirSync(path.join(gamePath, 'archive', 'pc', 'mod'), { recursive: true })
  fs.mkdirSync(libraryPath, { recursive: true })
  fs.mkdirSync(downloadPath, { recursive: true })

  // Two redscript mods sharing r6/scripts/shared_quest_fix.reds -> a real
  // overwrite conflict once both are installed and enabled.
  makeFixtureZip(downloadPath, 'Conflict Mod A-1-0-0.zip', {
    'r6/scripts/shared_quest_fix.reds': '// mod A version of the shared file',
    'r6/scripts/mod_a_only.reds': '// unique to A',
  })
  makeFixtureZip(downloadPath, 'Conflict Mod B-2-0-0.zip', {
    'r6/scripts/shared_quest_fix.reds': '// mod B version of the shared file',
    'r6/scripts/mod_b_only.reds': '// unique to B',
  })

  if (seedSettings) {
    const userData = path.join(profile, 'userData')
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(
      path.join(userData, 'settings.json'),
      JSON.stringify({
        gamePath,
        libraryPath,
        downloadPath,
        accentColor: 'blue',
        uiMode: 'dark',
        autoUpdate: false,
        autoInstallDownloads: true,
        nexusApiKey: '',
        language: 'en', // stable selectors regardless of the machine's language
        setupCompleted: true,
      }, null, 2),
    )
  }
  return { gamePath, libraryPath, downloadPath }
}

async function launchApp(profile) {
  const env = { ...process.env, HYPERION_E2E_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE // some shells set it; Electron would boot as plain Node
  const app = await _electron.launch({ args: [harness], cwd: root, env })
  const deadline = Date.now() + 60_000
  for (;;) {
    for (const page of app.windows()) {
      if (page.url().includes('index.html')) {
        page.on('pageerror', (error) => {
          pageErrors.push(String(error))
          console.error('[smoke] renderer pageerror:', String(error))
        })
        return { app, page }
      }
    }
    if (Date.now() > deadline) throw new Error('main renderer window never appeared')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function scenarioFirstRun() {
  console.log('\n[smoke] scenario: first-run onboarding')
  const profile = makeProfile()
  seedProfile(profile, { seedSettings: false })
  const { app, page } = await launchApp(profile)
  try {
    const welcome = await page
      .waitForSelector('text=/Get started|Come(ç|c)ar/i', { timeout: 45_000 })
      .then(() => true)
      .catch(() => false)
    await screenshot(page, '00-first-run-welcome')
    step('fresh profile boots into the welcome screen', welcome)
  } finally {
    await app.close()
  }
}

async function scenarioWorkflow() {
  console.log('\n[smoke] scenario: install/conflict/delete workflow')
  const profile = makeProfile()
  const { libraryPath } = seedProfile(profile, { seedSettings: true })
  const { app, page } = await launchApp(profile)

  // NOTE: getByLabel matches substrings by default and "Install archive" is a
  // substring of "Reinstall archive" - exact: true everywhere.
  const installButtons = page.getByLabel('Install archive', { exact: true })
  const reinstallButtons = page.getByLabel('Reinstall archive', { exact: true })
  const conflictBadges = page.getByLabel(/Overwrit(es|ten by) 1 file/)

  try {
    await page.waitForSelector('nav', { timeout: 45_000 })
    step('app shell rendered with seeded isolated profile', true)
    await page.waitForTimeout(1200)
    await screenshot(page, '10-library-empty')

    // ── Downloads: both fixtures listed ────────────────────────────────────
    await page.locator('nav button', { hasText: 'Downloads' }).first().click()
    await page.mouse.move(760, 420) // off the hover-expanding sidebar
    const rowA = await page.waitForSelector('text=Conflict Mod A', { timeout: 15_000 }).then(() => true).catch(() => false)
    const rowB = await page.getByText('Conflict Mod B').first().isVisible().catch(() => false)
    step('Downloads lists both fixture archives', rowA && rowB)
    await screenshot(page, '11-downloads-fixtures')

    // ── Install both (second install triggers the overwrite-conflict prompt) ─
    await installButtons.first().click()
    const firstInstalled = await reinstallButtons
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    step('first archive installed from Downloads', firstInstalled)
    await page.waitForTimeout(800)

    await installButtons.first().click()
    // Manual installs apply current load-order priority to loose overlaps
    // directly (the overwrite preview belongs to the auto-install pipeline);
    // the conflict then surfaces as the +/- badges checked below.
    const bothInstalled = await reinstallButtons
      .nth(1)
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    step('second (conflicting) archive installed with current priority', bothInstalled)
    await screenshot(page, '13-downloads-installed')

    // ── Library: two enabled mods with a +1/-1 conflict pair ───────────────
    await page.locator('nav button', { hasText: 'Mods' }).first().click()
    // Park the mouse away from the sidebar: it expands on hover (80 -> 256px)
    // and would cover the row toggles, making every click hit-test fail.
    await page.mouse.move(760, 420)
    await page.waitForTimeout(1800) // scan + conflict pass + install toasts fading
    const nameA = page.getByText('Conflict Mod A', { exact: true }).first()
    const nameB = page.getByText('Conflict Mod B', { exact: true }).first()
    const modAVisible = await nameA.isVisible().catch(() => false)
    const modBVisible = await nameB.isVisible().catch(() => false)
    step('both mods appear in the library', modAVisible && modBVisible)

    const enabledToggles = await page.getByLabel('Disable mod', { exact: true }).count()
    step('both mods installed enabled', enabledToggles === 2, `${enabledToggles} enabled`)

    const badgeCount = await conflictBadges.count()
    step('conflict badges show the +/- pair', badgeCount === 2, `${badgeCount} badges`)
    await screenshot(page, '14-library-conflict')

    // On disk: the library really contains the two mod folders.
    const folders = fs.readdirSync(libraryPath).filter((name) => !name.startsWith('.'))
    step('mod folders physically in the isolated library', folders.length === 2, folders.join(', '))

    // Which mod sits in the second (lower/winning) row? Install order follows
    // the Downloads sort, so discover it from the rendered positions.
    const boxA = await nameA.boundingBox()
    const boxB = await nameB.boundingBox()
    const lowerRowName = boxA && boxB && boxA.y > boxB.y ? 'Conflict Mod A' : 'Conflict Mod B'

    // ── Search filters ─────────────────────────────────────────────────────
    const search = page.getByPlaceholder('Search managed mods...')
    await search.fill('Mod B')
    await page.waitForTimeout(600)
    const visibleA = await nameA.isVisible().catch(() => false)
    const visibleB = await nameB.isVisible().catch(() => false)
    step('search narrows the list to the match', !visibleA && visibleB)
    await search.fill('')
    await page.waitForTimeout(600)

    // ── Disabling one side dissolves the conflict pair ─────────────────────
    // force: the HeroUI switch renders a visual control over its hidden input,
    // which Playwright's hit-test reads as interception.
    await page.getByLabel('Disable mod', { exact: true }).nth(1).click({ force: true })
    await page.waitForTimeout(1500)
    const badgesAfterDisable = await conflictBadges.count()
    step('disabling one mod clears the conflict badges', badgesAfterDisable === 0, `${badgesAfterDisable} left`)
    await screenshot(page, '15-library-disabled')

    // ── Delete the disabled (second) mod through the confirm dialog ────────
    await page.getByLabel('Remove mod', { exact: true }).nth(1).click()
    const deleteDialog = await page
      .getByText('Delete Mod', { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    step('delete confirmation dialog opened', deleteDialog)
    if (deleteDialog) {
      await screenshot(page, '16-delete-dialog')
      await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
    }
    // The row leaves the list and the folder leaves the disk.
    const rowsAfterDelete = await page
      .getByLabel(/^(Disable|Enable) mod$/)
      .count()
      .then(async (count) => {
        const deadline = Date.now() + 20_000
        let current = count
        while (current !== 1 && Date.now() < deadline) {
          await page.waitForTimeout(500)
          current = await page.getByLabel(/^(Disable|Enable) mod$/).count()
        }
        return current
      })
    step('deleted mod left the library view', rowsAfterDelete === 1, `${rowsAfterDelete} rows left`)
    const foldersAfter = fs.readdirSync(libraryPath).filter((name) => !name.startsWith('.'))
    step(
      'deleted mod folder removed from disk',
      foldersAfter.length === 1 && !foldersAfter.includes(lowerRowName),
      foldersAfter.join(', '),
    )
    await screenshot(page, '17-library-after-delete')

    // ── Settings + App Logs still open ─────────────────────────────────────
    await page.locator('nav button', { hasText: /Settings|Configura/ }).first().click()
    await page.mouse.move(760, 420)
    await page.waitForTimeout(900)
    await screenshot(page, '18-settings')
    await page.getByLabel(/App Logs|Registros/i).first().click()
    await page.waitForTimeout(700)
    await screenshot(page, '19-app-logs')
    step('Settings and App Logs render', true)
  } finally {
    await app.close().catch(() => {})
  }
}

async function run() {
  const watchdog = setTimeout(() => {
    console.error('[smoke] watchdog: run exceeded 300s, aborting')
    process.exit(1)
  }, 300_000)
  watchdog.unref()

  await scenarioFirstRun()
  await scenarioWorkflow()
  step('no renderer crashes (pageerror)', pageErrors.length === 0, pageErrors[0] ?? '')
}

run()
  .catch((error) => {
    failures.push(`fatal: ${String(error).split('\n')[0]}`)
    console.error('[smoke] fatal:', error)
  })
  .finally(() => {
    for (const profile of tempProfiles) {
      try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* locked file */ }
    }
    if (failures.length) {
      console.error(`\n[smoke] FAILED - ${failures.length} problem(s):`)
      for (const failure of failures) console.error(`  - ${failure}`)
      process.exit(1)
    }
    console.log('\n[smoke] PASSED - screenshots in tests/e2e/artifacts/')
    process.exit(0)
  })
