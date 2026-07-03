import { Outlet } from "react-router-dom"
import { Sidebar } from "@/components/sidebar/Sidebar"
import { Toaster } from "@/components/ui/sonner"
import { useDownloadsSocket } from "@/hooks/useDownloadsSocket"

export function AppLayout() {
  useDownloadsSocket()

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
