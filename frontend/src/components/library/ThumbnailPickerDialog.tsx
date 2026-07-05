import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useLibraryThumbnailCandidates, useSetLibraryThumbnail } from "@/hooks/useLibrary"
import { formatDuration } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"

interface ThumbnailPickerDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ThumbnailPickerDialog({ item, open, onOpenChange }: ThumbnailPickerDialogProps) {
  const { data, isFetching, isError, error, refetch } = useLibraryThumbnailCandidates(item.id, open)
  const setThumbnail = useSetLibraryThumbnail()

  const handlePick = (imageBase64: string) => {
    setThumbnail.mutate(
      { id: item.id, imageBase64 },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose a thumbnail</DialogTitle>
          <DialogDescription>4 frames pulled from across the video — pick one to use as the thumbnail.</DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Get 4 new frames
          </Button>
        </div>

        {isFetching ? (
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="aspect-video w-full" />
            <Skeleton className="aspect-video w-full" />
            <Skeleton className="aspect-video w-full" />
            <Skeleton className="aspect-video w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Failed to grab frames: {(error as Error).message}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {data?.candidates.map((candidate, i) => (
              <button
                key={i}
                type="button"
                disabled={setThumbnail.isPending}
                onClick={() => handlePick(candidate.imageBase64)}
                className="group relative overflow-hidden rounded-md border transition hover:ring-2 hover:ring-primary disabled:opacity-50"
              >
                <img
                  src={`data:image/jpeg;base64,${candidate.imageBase64}`}
                  alt={`Frame at ${formatDuration(candidate.timestampSeconds)}`}
                  className="aspect-video w-full object-cover"
                />
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                  {formatDuration(candidate.timestampSeconds)}
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
