import { Navigate, Outlet } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import { useAuthStatus } from "@/hooks/useAuth"
import { useDownloadsSocket } from "@/hooks/useDownloadsSocket"

// No Sidebar/MobileNav/BrowseHeader — just the auth guard and full-viewport
// content. Used for pages that need to own the entire screen (currently only
// the compare-list play page) rather than sit inside either management
// chrome (AppLayout) or the Browse chrome (BrowseLayout, which also carries
// MiniPlayerProvider — irrelevant here, since simultaneous multi-item
// playback has no single-item "minimize" concept).
export function ImmersiveLayout() {
  const { data: status, isLoading } = useAuthStatus()

  if (isLoading || !status) return null
  if (status.setupRequired || !status.authenticated) {
    return <Navigate to="/login" replace />
  }

  return <AuthedImmersiveLayout />
}

function AuthedImmersiveLayout() {
  useDownloadsSocket()

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <Outlet />
      <Toaster />
    </div>
  )
}
