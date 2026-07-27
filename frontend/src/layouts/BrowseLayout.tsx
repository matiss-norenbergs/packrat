import { useEffect } from "react"
import { matchPath, Navigate, Outlet, useLocation } from "react-router-dom"
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

  // The single-item player (/browse/:id) goes edge-to-edge, full viewport
  // — everything else in Browse keeps the header. This stays a conditional
  // within one layout, rather than a separate route branch, specifically so
  // MiniPlayerProvider/MiniPlayerDock (below) keep working exactly as they
  // do today: pulling /browse/:id out into its own branch would either break
  // the "minimize back to Browse" hand-off or require lifting the mini-player
  // context somewhere shared, both worse than one conditional here.
  const isSingleItemView = matchPath("/browse/:id", location.pathname) != null

  return (
    <MiniPlayerProvider>
      <div className="min-h-screen w-full bg-background text-foreground">
        {!isSingleItemView && <BrowseHeader />}
        <main>
          <Outlet />
        </main>
        <Toaster />
        <MiniPlayerDock />
      </div>
    </MiniPlayerProvider>
  )
}
