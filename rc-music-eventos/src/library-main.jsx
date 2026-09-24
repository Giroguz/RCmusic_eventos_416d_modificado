import React from 'react'
import ReactDOM from 'react-dom/client'
import DjLibraryStandaloneApp from './DjLibraryStandaloneApp'
import PwaInstallPrompt from './components/PwaInstallPrompt'
import './index.css'
import { LanguageProvider } from './lib/i18n'

if (!window.location.hash) {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}#dj-login`)
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/library/sw.js', { scope: '/library/' }).catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LanguageProvider>
      <>
        <DjLibraryStandaloneApp />
        <PwaInstallPrompt />
      </>
    </LanguageProvider>
  </React.StrictMode>,
)
