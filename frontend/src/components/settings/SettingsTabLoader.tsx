import type { ReactNode } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettings } from "@/hooks/useSettings"
import type { Settings } from "@/types/api"

// Loads the server settings once for a tab: the skeleton while they load, an
// error with Retry when they can't be loaded (rather than a skeleton forever),
// and otherwise the tab body with `settings` handed to it. A failed background
// refetch keeps the body on screen with the data it already has.
export function SettingsTabLoader({
  skeletonClassName = "h-24 w-full max-w-lg",
  children,
}: {
  skeletonClassName?: string
  children: (settings: Settings) => ReactNode
}) {
  const { data: settings, isError, isFetching, refetch } = useSettings()

  if (settings) return <>{children(settings)}</>
  if (isError) {
    return (
      <div role="alert" className="flex max-w-lg flex-col items-start gap-3">
        <p className="text-sm text-destructive">Couldn't load the settings. Check that the server is reachable.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw /> Retry
        </Button>
      </div>
    )
  }
  return <Skeleton className={skeletonClassName} />
}
