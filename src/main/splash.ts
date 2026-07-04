import { BrowserWindow, nativeTheme } from 'electron'
import { resolveAccent, type AccentPreset } from '../shared/theme/accents'

// Icon-only splash: nothing but the oversized brand mark (accent plate + white H,
// mirroring the app icon) gently floating on a fully transparent window with a
// soft pulsing accent glow - no card, no progress bar, no text.
export function buildSplashHtml(accent: AccentPreset, dark: boolean): string {
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

      /* Glow as a radial gradient BEHIND the mark - an animated drop-shadow filter
         creates a rectangular compositor layer that reads as a faint "invisible
         wall" over the desktop on transparent windows. A gradient fades to true
         transparency with no layer edge. */
      .glow {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 470px;
        height: 470px;
        margin-left: -235px;
        margin-top: -235px;
        border-radius: 50%;
        /* The icon covers the central ~330px - the visible glow lives in the outer
           ring, so the gradient must stay strong PAST the icon's edge (~70%). */
        background: radial-gradient(closest-side, rgb(var(--accent-rgb) / 0.55), rgb(var(--accent-rgb) / 0.38) 62%, rgb(var(--accent-rgb) / 0.16) 82%, transparent 100%);
        animation: glow-pulse 2s ease-in-out infinite;
        pointer-events: none;
      }

      .logo-mark {
        position: relative;
        width: 330px;
        height: 330px;
        display: block;
        animation: fade-in 0.35s ease forwards, float-mark 2s ease-in-out infinite;
        opacity: 0;
      }

      @keyframes fade-in {
        to { opacity: 1; }
      }

      @keyframes float-mark {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-8px); }
      }

      @keyframes glow-pulse {
        0%, 100% { opacity: 0.45; transform: scale(0.9); }
        50%      { opacity: 1; transform: scale(1.06); }
      }
    </style>
  </head>
  <body>
    <div class="glow" aria-hidden="true"></div>
    <svg class="logo-mark" width="330" height="330" viewBox="4 4 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="6" y="6" width="32" height="32" rx="9" fill="var(--accent)"></rect>
      <rect x="14.5" y="14" width="4" height="16" fill="#FFFFFF"></rect>
      <rect x="25.5" y="14" width="4" height="16" fill="#FFFFFF"></rect>
      <rect x="17.5" y="20" width="9" height="4" fill="#FFFFFF"></rect>
    </svg>
  </body>
</html>`
}

export function createSplashWindow(accentColorId?: string, uiMode?: 'light' | 'dark' | 'system'): BrowserWindow {
  const splash = new BrowserWindow({
    width: 480,
    height: 480,
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
