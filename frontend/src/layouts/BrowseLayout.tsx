import { lazy, Suspense, useEffect } from "react"
import { matchPath, Navigate, Outlet, useLocation } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import { useAuthStatus } from "@/hooks/useAuth"
import { useSyncAppearance } from "@/hooks/useAppearance"
import { useDownloadsSocket } from "@/hooks/useDownloadsSocket"
import { BrowseHeader } from "@/components/browse/BrowseHeader"
import { MiniPlayerProvider, useMiniPlayer } from "@/components/browse/MiniPlayerContext"

// The dock pulls in the whole player skin, which only matters once an item has been minimized, so
// it is its own chunk instead of part of the entry chunk every page loads. Not a route reveal, so
// a lazy component with no visible fallback is fine here.
const loadMiniPlayerDock = () => import("@/components/browse/MiniPlayerDock")
const MiniPlayerDock = lazy(() => loadMiniPlayerDock().then((m) => ({ default: m.MiniPlayerDock })))

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
  useSyncAppearance() // same rationale: /browse can be the first page opened, so it applies the account's theme/accent too
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

  // Minimizing is only possible from the item page, which has the player skin loaded already:
  // fetch the (tiny) dock chunk there, so the mini player appears the moment it is minimized.
  useEffect(() => {
    if (isSingleItemView) void loadMiniPlayerDock().catch(() => {})
  }, [isSingleItemView])

  return (
    <MiniPlayerProvider>
      {/* dvh: a phone's collapsing browser bars make 100vh taller than what is visible. */}
      <div className="min-h-dvh w-full bg-background text-foreground">
        {!isSingleItemView && <BrowseHeader />}
        <BrowseMain />
        <Toaster />
        <MiniPlayerHost />
      </div>
    </MiniPlayerProvider>
  )
}

function MiniPlayerHost() {
  const { miniPlayer } = useMiniPlayer()
  if (!miniPlayer) return null
  return (
    <Suspense fallback={null}>
      <MiniPlayerDock />
    </Suspense>
  )
}

// While the mini player is open it floats over the bottom-right corner; the extra bottom padding
// (its height plus its offset, a little more on sm+ where it is wider) lets the page's last row be
// scrolled out from under it instead of staying covered.
function BrowseMain() {
  const { miniPlayer } = useMiniPlayer()
  return (
    <main className={miniPlayer ? "pb-56 sm:pb-64" : undefined}>
      <Outlet />
    </main>
  )
}
