import { useEffect } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router-dom"
import { ThemeProvider } from "next-themes"
import { DesktopGate } from "@/components/DesktopGate"
import { authStatusQueryKey, markLoggedOut } from "@/hooks/useAuth"
import { useDesktopIcon } from "@/hooks/useDesktopIcon"
import { useTrayServers } from "@/hooks/useTrayServers"
import { queryClient } from "@/lib/queryClient"
import { showsConnectScreen, UNAUTHORIZED_EVENT } from "@/lib/server"
import { ConnectPage } from "@/pages/ConnectPage"
import { router } from "@/routes"
import type { AuthStatus } from "@/types/api"
// Side-effect only — applies the cached accent color to <html> as soon as
// this module evaluates (before first paint), regardless of whether the
// Settings page (the only place useAccentColor's hook is actually called)
// has been visited yet.
import "@/hooks/useAccentColor"

// next-themes renders an inline "no flash" <script> for server-rendered pages. This app is
// client-rendered only, where React never executes a script it renders (and logs an error about it
// in dev) — so it was always inert here. Typing it as a data block keeps React quiet and changes
// nothing else; the theme is applied by the provider's effect and the localStorage cache (see
// "Appearance preferences" in docs/architecture.md). An inline script in index.html would be the
// real pre-paint fix but is blocked by the desktop shell's CSP (script-src 'self').
const themeProviderProps = {
  attribute: "class",
  defaultTheme: "system",
  enableSystem: true,
  scriptProps: { type: "application/json" },
} as const

function App() {
  useTrayServers()
  useDesktopIcon()

  // The server rejected our session (revoked/expired; web cookie or desktop token) — drop to the
  // login screen the same way a logout does, rather than leaving a page full of failing requests
  // and stale (possibly revealed private) data. A burst of 401s lands here once per request; only
  // the first does the work.
  useEffect(() => {
    const onUnauthorized = () => {
      if (queryClient.getQueryData<AuthStatus>(authStatusQueryKey)?.authenticated === false) return
      markLoggedOut(queryClient)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  // Desktop with no server chosen yet (or "Add server…"): nothing to render the router against.
  if (showsConnectScreen()) {
    return (
      <ThemeProvider {...themeProviderProps}>
        <ConnectPage />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider {...themeProviderProps}>
      <QueryClientProvider client={queryClient}>
        <DesktopGate>
          <RouterProvider router={router} />
        </DesktopGate>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
