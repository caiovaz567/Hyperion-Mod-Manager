import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { I18nProvider } from './i18n/I18nContext'
import { AppThemeProvider } from './theme/ThemeContext'
import './styles/globals.css'

const root = document.getElementById('root')!

// HeroUI v3 needs no provider — its components read the theme CSS variables that
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
