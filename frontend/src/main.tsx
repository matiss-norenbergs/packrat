import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.tsx'
import { installExternalLinkHandler } from './lib/desktop.ts'
import { initTokenStore } from './lib/server.ts'

installExternalLinkHandler()

// Desktop shell: the login token comes from the OS keychain, so load it before anything reads it
// (a no-op on the web). initTokenStore never rejects, so the app always renders.
void initTokenStore().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
