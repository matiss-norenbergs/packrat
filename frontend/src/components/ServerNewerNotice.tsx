import { ArrowUpCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useServerNewerNotice } from "@/hooks/useServerNewerNotice"
import { router } from "@/routes"

// Desktop only, signed in only (see DesktopGate). Floats like the connection banner so it doesn't
// disturb any page's layout.
export function ServerNewerNotice() {
  const { notice, dismiss } = useServerNewerNotice()
  if (!notice) return null

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg"
    >
      <ArrowUpCircle className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        Your server (v{notice.server.replace(/^v/, "")}) is newer than this app (v{notice.app.replace(/^v/, "")}).
        Update the app in Settings → Desktop.
      </span>
      <Button
        size="sm"
        className="h-7 shrink-0"
        onClick={() => {
          dismiss()
          void router.navigate("/settings?tab=desktop")
        }}
      >
        Open settings
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Dismiss" onClick={dismiss}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
