import React from 'react'
import ReactDOM from 'react-dom/client'
// Self-hosted fonts (bundled by Vite): the app must never fetch fonts from the
// network at boot - the old Google Fonts <link> added a round-trip to every cold
// start (with display=block hiding all text meanwhile) and broke offline launches.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/syne/400.css'
import '@fontsource/syne/600.css'
import '@fontsource/syne/700.css'
import '@fontsource/syne/800.css'
import '@fontsource/oxanium/500.css'
import '@fontsource/oxanium/600.css'
import '@fontsource/oxanium/700.css'
import '@fontsource/jetbrains-mono/400.css'
import { App } from './App'
import { I18nProvider } from './i18n/I18nContext'
import { AppThemeProvider } from './theme/ThemeContext'
import './styles/globals.css'

const root = document.getElementById('root')!

// HeroUI v3 needs no provider - its components read the theme CSS variables that
// AppThemeProvider injects onto <html>. MUI's ThemeProvider/CssBaseline were removed
// as part of the HeroUI migration.
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </AppThemeProvider>
  </React.StrictMode>
)
