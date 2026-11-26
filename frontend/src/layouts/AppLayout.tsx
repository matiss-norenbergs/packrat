import { useEffect, useRef, type RefObject } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { FloatingActionDock } from "@/components/FloatingActionDock"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { LibrarySortProvider } from "@/components/library/LibrarySortContext"
import { MobileNav } from "@/components/sidebar/MobileNav"
import { Sidebar } from "@/components/sidebar/Sidebar"
import { Toaster } from "@/components/ui/sonner"
import { useAuthStatus } from "@/hooks/useAuth"
import { isBrowseOnlyApp } from "@/lib/appMode"
import { BrowseOnlyRedirect } from "@/components/BrowseOnlyRedirect"
import { useSyncAppearance } from "@/hooks/useAppearance"
import { useTableLayouts } from "@/hooks/useTableLayout"
import { useDownloadsSocket } from "@/hooks/useDownloadsSocket"

export function AppLayout() {
  const { data: status, isLoading } = useAuthStatus()

  // The Android app shows only the Browse pages: every management route (including "/", the
  // Dashboard) goes to Browse home, which then does its own sign-in check.
  if (isBrowseOnlyApp()) return <BrowseOnlyRedirect />

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
  useSyncAppearance()
  useTableLayouts() // fetched once for every table; each table's useTableLayout reads the same cache entry
  const mainRef = useRef<HTMLElement>(null)

  return (
    // One RevealAllProvider for every page under this layout, so reveal-all
    // survives in-app navigation (still in-memory only: a reload resets it);
    // individually revealed items are cleared on every route change.
    <RevealAllProvider clearOnNavigate>
      <LibrarySortProvider>
        <FloatingActionDock>
          <div className="flex h-dvh w-full flex-col bg-background text-foreground md:flex-row">
            <MobileNav />
            <Sidebar />
            <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
              <Outlet />
            </main>
            <ScrollToTopOnRoute scrollRef={mainRef} />
            <Toaster />
          </div>
        </FloatingActionDock>
      </LibrarySortProvider>
    </RevealAllProvider>
  )
}

// main (not window) is the scroll container here, so a route change
// doesn't reset scroll on its own — without this, navigating to an item
// page while scrolled down in the library grid opens already scrolled past
// the player. A leaf component, so AuthedAppLayout itself (and the providers and pages under it) does not
// re-render on every URL change just to run this effect.
function ScrollToTopOnRoute({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const { pathname } = useLocation()
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
  }, [pathname, scrollRef])
  return null
}
