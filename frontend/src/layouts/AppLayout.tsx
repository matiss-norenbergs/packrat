import { Navigate, Outlet } from "react-router-dom"
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

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground md:flex-row">
      <MobileNav />
      <Sidebar />
      <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
