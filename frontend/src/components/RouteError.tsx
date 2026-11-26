import { useEffect, useState } from "react"
import { isRouteErrorResponse, useRouteError } from "react-router-dom"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isChunkLoadError, reloadForStaleChunk } from "@/lib/chunkReload"
import { isBrowseOnlyApp } from "@/lib/appMode"
import { BrowseOnlyRedirect } from "@/components/BrowseOnlyRedirect"

// Root route error element. A failed page chunk (stale tab after a deploy)
// reloads the app once automatically; anything else, or a second failure,
// shows the message with a manual Reload button.
export function RouteError() {
  const error = useRouteError()
  // The Android app's Browse-only mode: an unknown path goes to Browse home, like the admin routes.
  if (isBrowseOnlyApp() && isRouteErrorResponse(error) && error.status === 404) return <BrowseOnlyRedirect />
  return <RouteErrorMessage error={error} />
}

function RouteErrorMessage({ error }: { error: unknown }) {
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
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <h1 className="text-xl font-semibold">{chunkError ? "Couldn't load this page" : "Something went wrong"}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      <Button onClick={() => window.location.reload()}>
        <RefreshCw /> Reload
      </Button>
    </div>
  )
}
