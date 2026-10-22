import { useState, useSyncExternalStore } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isOffline, retryNow, subscribe } from "@/lib/connection"

// Desktop only (the connection monitor never goes offline on the web). A small pill at the top of
// the window — floating, so it doesn't disturb any page's layout.
export function ConnectionBanner() {
  const offline = useSyncExternalStore(subscribe, isOffline)
  const [checking, setChecking] = useState(false)
  if (!offline) return null

  const handleRetry = async () => {
    setChecking(true)
    await retryNow()
    setChecking(false)
  }

  return (
    <div
      role="status"
      className="fixed left-1/2 top-3 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full border border-warning/50 bg-card px-4 py-2 text-sm shadow-lg"
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-warning" />
      <span>Can't reach the server — retrying…</span>
      <Button size="sm" variant="outline" className="h-7" onClick={handleRetry} disabled={checking}>
        Retry now
      </Button>
    </div>
  )
}
