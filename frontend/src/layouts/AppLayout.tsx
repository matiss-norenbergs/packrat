import { useEffect, useRef } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { MobileNav } from "@/components/sidebar/MobileNav"
import { Sidebar } from "@/components/sidebar/Sidebar"
import { Toaster } from "@/components/ui/sonner"
import { useAuthStatus } from "@/hooks/useAuth"
import { useDownloadsSocket } from "@/hooks/useDownloadsSocket"

export function AppLayout() {
  const { data: status, isLoading } = useAuthStatus()

  if (isLoading || !status) return null
  if (status.setupRequired || !status.authenticated) {
    return <Navigate to="/login" replace />
  }

  return <AuthedAppLayout />
}

// Split out so useDownloadsSocket() (and every other protected-page query)
// only ever mounts once we know the user is authenticated — never during
// the loading/unauthenticated flash above.
function AuthedAppLayout() {
  useDownloadsSocket()
  const mainRef = useRef<HTMLElement>(null)
  const location = useLocation()

  // main (not window) is the scroll container here, so a route change
  // doesn't reset scroll on its own — without this, navigating to an item
  // page while scrolled down in the library grid opens already scrolled past
  // the player.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground md:flex-row">
      <MobileNav />
      <Sidebar />
      <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
