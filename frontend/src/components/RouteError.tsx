import { useEffect, useState } from "react"
import { useRouteError } from "react-router-dom"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isChunkLoadError, reloadForStaleChunk } from "@/lib/chunkReload"

// Root route error element. A failed page chunk (stale tab after a deploy)
// reloads the app once automatically; anything else, or a second failure,
// shows the message with a manual Reload button.
export function RouteError() {
  const error = useRouteError()
  const chunkError = isChunkLoadError(error)
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    if (chunkError && reloadForStaleChunk()) setReloading(true)
  }, [chunkError])

  useEffect(() => {
    if (!chunkError) console.error(error)
  }, [chunkError, error])

  if (reloading) return null

  const message = chunkError
    ? "A new version of Packrat is available, or a page file could not be loaded."
    : error instanceof Error
      ? error.message
      : "Something went wrong."

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <h1 className="text-xl font-semibold">{chunkError ? "Couldn't load this page" : "Something went wrong"}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      <Button onClick={() => window.location.reload()}>
        <RefreshCw /> Reload
      </Button>
    </div>
  )
}
