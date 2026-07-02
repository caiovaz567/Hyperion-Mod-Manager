import { BrowserWindow, nativeTheme } from 'electron'
import { resolveAccent, type AccentPreset } from '../shared/theme/accents'

// HeroUI-style splash: a flat, borderless card (same surface language as the app, light or
// dark following the user's uiMode), the brand mark tinted with the chosen accent color,
// and a quiet rounded indeterminate progress bar. No glows, rotating frames, or beams.
function buildSplashHtml(accent: AccentPreset, dark: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#0d0d10" />
    <title>Hyperion</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      :root {
        --bg: ${dark ? '#0d0d10' : '#ffffff'};
        --surface: ${dark ? '#17171c' : '#e9e9ec'};
        --text: ${dark ? '#ececf1' : '#18181b'};
        --edge: ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'};
        --accent: ${accent.accent};
        --accent-foreground: ${accent.foreground};
        --accent-rgb: ${accent.rgb};
      }

      html, body {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }

      body {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text);
        font-family: "Inter", "Segoe UI Variable Display", "Segoe UI", sans-serif;
        -webkit-app-region: drag;
        user-select: none;
        position: relative;
      }

      .window-surface {
        position: absolute;
        inset: 0;
        border-radius: 16px;
        overflow: hidden;
        background: var(--bg);
        box-shadow:
          0 18px 44px rgba(0,0,0,${dark ? '0.5' : '0.22'}),
          inset 0 0 0 1px var(--edge);
      }

      .shell {
        position: relative;
        width: 420px;
        min-height: 230px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 22px;
      }

      .logo-mark {
        width: 64px;
        height: 64px;
        display: block;
        animation: fade-in 0.35s ease forwards, float-mark 2s ease-in-out infinite;
        opacity: 0;
      }

      .brand-lockup {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
      }

      .title {
        font-size: 24px;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: var(--text);
        line-height: 1;
        text-transform: uppercase;
        animation: fade-in 0.4s 0.12s ease forwards;
        opacity: 0;
      }

      .progress-track {
        width: 190px;
        height: 5px;
        border-radius: 999px;
        background: var(--surface);
        position: relative;
        overflow: hidden;
      }

      .progress-bar {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        /* Fills from the left, then drains from the right — a calm, self-contained
           loop that never travels outside the track. */
        background: var(--accent);
        animation: indeterminate 1.5s ease-in-out infinite;
        will-change: transform;
      }

      @keyframes fade-in {
        to { opacity: 1; }
      }

      @keyframes float-mark {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-4px); }
      }

      @keyframes indeterminate {
        0%     { transform: scaleX(0); transform-origin: left; }
        50%    { transform: scaleX(1); transform-origin: left; }
        50.01% { transform: scaleX(1); transform-origin: right; }
        100%   { transform: scaleX(0); transform-origin: right; }
      }
    </style>
  </head>
  <body>
    <div class="window-surface" aria-hidden="true"></div>
    <div class="shell">
      <svg class="logo-mark" width="64" height="64" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="6" y="6" width="32" height="32" rx="9" fill="var(--accent)"></rect>
        <rect x="16" y="16" width="12" height="12" rx="3" fill="var(--accent-foreground)"></rect>
      </svg>
      <div class="brand-lockup">
        <span class="title">Hyperion</span>
        <div class="progress-track">
          <div class="progress-bar"></div>
        </div>
      </div>
    </div>
  </body>
</html>`
}

export function createSplashWindow(accentColorId?: string, uiMode?: 'light' | 'dark' | 'system'): BrowserWindow {
  const splash = new BrowserWindow({
    width: 480,
    height: 300,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const dark = uiMode === 'dark' || (uiMode !== 'light' && nativeTheme.shouldUseDarkColors)
  const splashHtml = buildSplashHtml(resolveAccent(accentColorId), dark)
  const splashUrl = `data:text/html;charset=UTF-8,${encodeURIComponent(splashHtml)}`

  let revealed = false
  let fadeInterval: NodeJS.Timeout | null = null

  const animateSplashOpacity = (targetOpacity: number, durationMs: number) => new Promise<void>((resolve) => {
    if (splash.isDestroyed()) {
      resolve()
      return
    }

    if (fadeInterval) {
      clearInterval(fadeInterval)
      fadeInterval = null
    }

    const startOpacity = splash.getOpacity()
    const startedAt = Date.now()
    const tickMs = 16

    const applyOpacity = () => {
      if (splash.isDestroyed()) {
        if (fadeInterval) {
          clearInterval(fadeInterval)
          fadeInterval = null
        }
        resolve()
        return
      }

      const elapsed = Date.now() - startedAt
      const progress = Math.min(1, elapsed / durationMs)
      const easedProgress = 1 - Math.pow(1 - progress, 3)
      const nextOpacity = startOpacity + ((targetOpacity - startOpacity) * easedProgress)
      splash.setOpacity(nextOpacity)

      if (progress >= 1) {
        if (fadeInterval) {
          clearInterval(fadeInterval)
          fadeInterval = null
        }
        resolve()
      }
    }

    applyOpacity()
    fadeInterval = setInterval(applyOpacity, tickMs)
  })

  const revealSplash = async () => {
    if (revealed || splash.isDestroyed()) return
    revealed = true

    splash.setOpacity(0)
    splash.showInactive()
    splash.moveTop()

    try {
      await splash.webContents.executeJavaScript(`
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve(true))
          })
        })
      `)
    } catch {
      // Ignore; we'll still reveal the splash below.
    }

    if (splash.isDestroyed()) return
    await animateSplashOpacity(1, 180)
    splash.moveTop()
  }

  splash.loadURL(splashUrl)
  splash.webContents.once('did-finish-load', () => {
    void revealSplash()
  })
  splash.once('closed', () => {
    if (fadeInterval) {
      clearInterval(fadeInterval)
      fadeInterval = null
    }
  })

  return splash
}
