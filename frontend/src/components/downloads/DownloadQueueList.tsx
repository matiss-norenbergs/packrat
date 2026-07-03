import { useDownloads } from "@/hooks/useDownloads"
import { Skeleton } from "@/components/ui/skeleton"
import { DownloadQueueItem } from "./DownloadQueueItem"

export function DownloadQueueList() {
  const { data, isLoading, isError, error } = useDownloads()

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (isError) {
    return <p className="text-sm text-destructive">Failed to load downloads: {(error as Error).message}</p>
  }

  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">No downloads yet. Click "New Download" to get started.</p>
  }

  return (
    <div className="space-y-3">
      {data.map((d) => (
        <DownloadQueueItem key={d.id} download={d} />
      ))}
    </div>
  )
}
