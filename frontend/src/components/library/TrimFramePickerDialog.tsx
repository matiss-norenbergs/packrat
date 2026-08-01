import { useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useLibraryItemTrimFrames } from "@/hooks/useLibrary"
import { formatPreciseTime } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"

interface TrimFramePickerDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
  windowStart: number
  windowEnd: number
  onPick: (timestampSeconds: number) => void
}

// Every decoded frame in [windowStart, windowEnd) as a clickable grid —
// lets the user pick an exact trim point by looking at real frames instead
// of trusting the browser <video> element's own (not reliably
// frame-accurate) seeking. Only offered for short windows — see
// MAX_FRAME_WINDOW_SECONDS in TrimLibraryItemDialog.tsx.
export function TrimFramePickerDialog({
  item,
  open,
  onOpenChange,
  windowStart,
  windowEnd,
  onPick,
}: TrimFramePickerDialogProps) {
  const fetchFrames = useLibraryItemTrimFrames()

  useEffect(() => {
    if (!open) return
    fetchFrames.mutate({ id: item.id, start: windowStart, end: windowEnd })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handlePick = (timestampSeconds: number) => {
    onPick(timestampSeconds)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pick exact frame</DialogTitle>
          <DialogDescription>
            Every frame from {formatPreciseTime(windowStart)} to {formatPreciseTime(windowEnd)} — click the one to use.
          </DialogDescription>
        </DialogHeader>

        {fetchFrames.isPending || fetchFrames.isIdle ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 24 }).map((_, i) => (
              <Skeleton key={i} className="h-[70px] w-[110px] shrink-0" />
            ))}
          </div>
        ) : fetchFrames.isError ? (
          <p className="text-sm text-destructive">Couldn't load frames: {(fetchFrames.error as Error).message}</p>
        ) : fetchFrames.data.frames.length === 0 ? (
          <p className="text-sm text-muted-foreground">No frames found in this range.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {fetchFrames.data.frames.map((frame, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handlePick(frame.timestampSeconds)}
                className="group relative h-[70px] w-[110px] shrink-0 overflow-hidden rounded-md border transition hover:ring-2 hover:ring-primary"
              >
                <img
                  src={`data:image/jpeg;base64,${frame.imageBase64}`}
                  alt={`Frame at ${formatPreciseTime(frame.timestampSeconds)}`}
                  className="h-full w-full object-cover"
                />
                <span className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">
                  {formatPreciseTime(frame.timestampSeconds)}
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
