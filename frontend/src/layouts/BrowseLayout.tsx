import { useEffect } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import { useAuthStatus } from "@/hooks/useAuth"
import { useDownloadsSocket } from "@/hooks/useDownloadsSocket"
import { BrowseHeader } from "@/components/browse/BrowseHeader"
import { MiniPlayerProvider } from "@/components/browse/MiniPlayerContext"
import { MiniPlayerDock } from "@/components/browse/MiniPlayerDock"

// A deliberately separate layout from AppLayout — no Sidebar/MobileNav, so
// the Browse experience never shares chrome with the management area (see
// the Browse page plan). Mirrors AppLayout's auth guard exactly.
export function BrowseLayout() {
  const { data: status, isLoading } = useAuthStatus()

  if (isLoading || !status) return null
  if (status.setupRequired || !status.authenticated) {
    return <Navigate to="/login" replace />
  }

  return <AuthedBrowseLayout />
}

// Split out so useDownloadsSocket() (and every other protected-page query)
// only ever mounts once we know the user is authenticated — same rationale
// as AppLayout's AuthedAppLayout split.
function AuthedBrowseLayout() {
  useDownloadsSocket()
  const location = useLocation()

  // This layout scrolls the document itself (no internal main scroll
  // container like AppLayout), so a route change needs an explicit
  // window.scrollTo — otherwise opening an item while scrolled down in the
  // rows/grid opens already scrolled past the player.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <MiniPlayerProvider>
      <div className="min-h-screen w-full bg-background text-foreground">
        <BrowseHeader />
        <main>
          <Outlet />
        </main>
        <Toaster />
        <MiniPlayerDock />
      </div>
    </MiniPlayerProvider>
  )
}
