import { Skeleton } from "@/components/ui/skeleton"
import { DownloadQueueItem } from "./DownloadQueueItem"
import type { Download } from "@/types/api"

export function DownloadQueueList({
  downloads,
  isLoading,
  isError,
  error,
  isEmpty,
  isSelected,
  onToggle,
  onItemMouseDown,
  onItemMouseEnter,
}: {
  downloads: Download[]
  isLoading: boolean
  isError: boolean
  error: unknown
  isEmpty: boolean
  isSelected: (id: number) => boolean
  onToggle: (id: number) => void
  onItemMouseDown: (e: React.MouseEvent, id: number) => void
  onItemMouseEnter: (id: number) => void
}) {
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

  if (isEmpty) {
    return <p className="text-sm text-muted-foreground">No downloads yet. Click "New Download" to get started.</p>
  }

  if (downloads.length === 0) {
    return <p className="text-sm text-muted-foreground">No downloads match your search.</p>
  }

  return (
    <div className="space-y-3">
      {downloads.map((d) => (
        <DownloadQueueItem
          key={d.id}
          download={d}
          selected={isSelected(d.id)}
          onSelectedChange={() => onToggle(d.id)}
          onMouseDown={(e) => onItemMouseDown(e, d.id)}
          onMouseEnter={() => onItemMouseEnter(d.id)}
        />
      ))}
    </div>
  )
}
