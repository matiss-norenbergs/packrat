import { ArrowDownCircle, ArrowUpCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useVersionMismatchNotice } from "@/hooks/useVersionMismatchNotice"
import { router } from "@/routes"

const v = (version: string) => `v${version.replace(/^v/, "")}`

// Desktop only, signed in only (see DesktopGate). Floats like the connection banner so it doesn't
// disturb any page's layout.
export function VersionMismatchNotice() {
  const { notice, dismiss } = useVersionMismatchNotice()
  if (!notice) return null

  const Icon = notice.kind === "server-newer" ? ArrowUpCircle : ArrowDownCircle

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg"
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        {notice.kind === "server-newer" ? (
          <>
            Your server ({v(notice.server)}) is newer than this app ({v(notice.app)}). Update the app in Settings →
            Desktop.
          </>
        ) : (
          <>
            Your app ({v(notice.app)}) is newer than your server ({v(notice.server)}). Some features may not work
            until you update the server — or install the matching app version in Settings → Desktop.
          </>
        )}
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
