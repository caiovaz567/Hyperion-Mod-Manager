// Hyperion smoke test: launches the REAL app (Electron + main + renderer) and
// walks the basic user path - window opens, every screen renders, App Logs
// opens - failing loudly on any renderer crash. It never installs, deletes or
// changes settings: navigation only, safe to run against a real setup.
//
// Run with: npm run test:e2e   (builds out/ first, then drives it)
// Screenshots land in tests/e2e/artifacts/.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { _electron } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const artifactsDir = path.join(root, 'tests', 'e2e', 'artifacts')
fs.mkdirSync(artifactsDir, { recursive: true })

const failures = []
const pageErrors = []
let electronApp = null

function step(name, ok, detail = '') {
  const mark = ok ? 'ok  ' : 'FAIL'
  console.log(`[smoke] ${mark} ${name}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`)
}

async function screenshot(page, name) {
  try {
    await page.screenshot({ path: path.join(artifactsDir, `${name}.png`) })
  } catch {
    // Screenshots are diagnostics, never a reason to fail the smoke.
  }
}

// The splash is its own window (data: URL); the main renderer window loads
// index.html. Poll until it shows up.
async function findMainWindow(app, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    for (const page of app.windows()) {
      if (page.url().includes('index.html')) return page
    }
    if (Date.now() > deadline) throw new Error('main renderer window never appeared')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function run() {
  // Overall watchdog: a hung app must not hang the test run.
  const watchdog = setTimeout(() => {
    console.error('[smoke] watchdog: run exceeded 180s, aborting')
    process.exit(1)
  }, 180_000)
  watchdog.unref()

  console.log('[smoke] launching Hyperion (out/main/index.js)...')
  // ELECTRON_RUN_AS_NODE (set by some CLIs/CI shells) makes Electron boot as
  // plain Node and the app never starts - always launch with it cleared.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  electronApp = await _electron.launch({ args: ['.'], cwd: root, env })
  step('app process launched', true)

  const page = await findMainWindow(electronApp)
  step('main window appeared', true, page.url())

  page.on('pageerror', (error) => {
    pageErrors.push(String(error))
    console.error('[smoke] renderer pageerror:', String(error))
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.warn('[smoke] console.error:', message.text())
  })

  // The shell (sidebar) appears after boot unless first-run onboarding is due.
  const shell = await Promise.race([
    page.waitForSelector('nav', { timeout: 45_000 }).then(() => 'shell'),
    page.waitForSelector('text=/Get started|Come(ç|c)ar/i', { timeout: 45_000 }).then(() => 'welcome'),
  ]).catch(() => null)

  if (shell === 'welcome') {
    // Fresh machine: reaching a rendered welcome screen already proves boot.
    step('welcome screen rendered (first-run state)', true)
    await screenshot(page, '00-welcome')
  } else {
    step('app shell rendered', shell === 'shell')
    await page.waitForTimeout(1500) // let the library scan settle
    await screenshot(page, '01-library')

    // Navigate: Downloads -> Settings -> back to Mods. Labels exist in the DOM
    // even while the sidebar is collapsed.
    const views = [
      { name: 'downloads', locator: page.locator('nav button', { hasText: 'Downloads' }).first(), shot: '02-downloads' },
      { name: 'settings', locator: page.locator('nav button', { hasText: /Settings|Configura/ }).first(), shot: '03-settings' },
      { name: 'library', locator: page.locator('nav button', { hasText: 'Mods' }).first(), shot: '04-library-back' },
    ]
    for (const view of views) {
      try {
        await view.locator.click({ timeout: 10_000, force: true })
        await page.waitForTimeout(1200)
        await screenshot(page, view.shot)
        step(`navigated to ${view.name}`, true)
      } catch (error) {
        await screenshot(page, `${view.shot}-failed`)
        step(`navigated to ${view.name}`, false, String(error).split('\n')[0])
      }
    }

    // App Logs overlay from the header terminal button.
    try {
      await page.getByLabel(/App Logs|Registros/i).first().click({ timeout: 10_000 })
      await page.waitForTimeout(800)
      await screenshot(page, '05-app-logs')
      step('opened App Logs', true)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    } catch (error) {
      step('opened App Logs', false, String(error).split('\n')[0])
    }
  }

  step('no renderer crashes (pageerror)', pageErrors.length === 0, pageErrors[0] ?? '')

  await electronApp.close()
  step('app closed cleanly', true)
}

run()
  .catch((error) => {
    failures.push(`fatal: ${String(error).split('\n')[0]}`)
    console.error('[smoke] fatal:', error)
  })
  .finally(async () => {
    try { await electronApp?.close() } catch { /* already closed */ }
    if (failures.length) {
      console.error(`\n[smoke] FAILED - ${failures.length} problem(s):`)
      for (const failure of failures) console.error(`  - ${failure}`)
      process.exit(1)
    }
    console.log(`\n[smoke] PASSED - screenshots in tests/e2e/artifacts/`)
    process.exit(0)
  })
