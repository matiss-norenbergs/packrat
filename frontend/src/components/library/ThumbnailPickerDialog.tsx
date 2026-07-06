import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useLibraryThumbnailCandidates, useSetLibraryThumbnail } from "@/hooks/useLibrary"
import { useSettings } from "@/hooks/useSettings"
import { formatDuration } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"

interface ThumbnailPickerDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Literal class strings, not a "grid-cols-" + n template — Tailwind's
// build-time class scanner only picks up whole strings it can find verbatim.
const GRID_COLS: Record<number, string> = {
  2: "grid-cols-2",
  4: "grid-cols-2",
  6: "grid-cols-3",
  8: "grid-cols-4",
}

const GRID_COLS_COUNT: Record<number, number> = {
  2: 2,
  4: 2,
  6: 3,
  8: 4,
}

export function ThumbnailPickerDialog({ item, open, onOpenChange }: ThumbnailPickerDialogProps) {
  const { data, isFetching, isError, error, refetch } = useLibraryThumbnailCandidates(item.id, open)
  const setThumbnail = useSetLibraryThumbnail()
  const { data: settings } = useSettings()

  const frameCount = settings?.thumbnailFrameCount || 4
  const gridColsClass = GRID_COLS[frameCount] || GRID_COLS[4]
  const cols = GRID_COLS_COUNT[frameCount] || GRID_COLS_COUNT[4]
  const rows = Math.ceil(frameCount / cols)
  // Fixed per-row height (not aspect-ratio-derived) so total grid height —
  // rows * rowHeight + gaps — always stays within the dialog's max-h-[90vh],
  // no matter the frame count. 9.5rem reserves space for the header,
  // toolbar, and dialog padding above the grid; object-cover crops each
  // frame to fill its cell instead of letting width dictate height, which
  // is what caused a scrollbar to appear with fewer/wider columns before.
  const budgetHeight = `calc((90vh - 9.5rem - ${(rows - 1) * 0.75}rem) / ${rows})`
  // With few rows (e.g. 1 row for 2 frames), the budget above can exceed a
  // real video frame's proportions, cropping tiles into near-squares. Cap
  // each cell at the height a true 16:9 frame would be for its column's
  // width, so it only shrinks below that on short viewports — the smaller
  // of the two is used via min().
  const columnWidth = `calc((95vw - 2rem - ${(cols - 1) * 0.75}rem) / ${cols})`
  const aspectCapHeight = `calc(${columnWidth} * 9 / 16)`
  const rowHeight = `min(${budgetHeight}, ${aspectCapHeight})`

  const handlePick = (imageBase64: string) => {
    setThumbnail.mutate(
      { id: item.id, imageBase64 },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose a thumbnail</DialogTitle>
          <DialogDescription>{frameCount} frames pulled from across the video — pick one to use as the thumbnail.</DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Get {frameCount} new frames
          </Button>
        </div>

        {isFetching ? (
          <div className={`grid ${gridColsClass} gap-3`} style={{ gridAutoRows: rowHeight }}>
            {Array.from({ length: frameCount }).map((_, i) => (
              <Skeleton key={i} className="h-full w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Failed to grab frames: {(error as Error).message}</p>
        ) : (
          <div className={`grid ${gridColsClass} gap-3`} style={{ gridAutoRows: rowHeight }}>
            {data?.candidates.map((candidate, i) => (
              <button
                key={i}
                type="button"
                disabled={setThumbnail.isPending}
                onClick={() => handlePick(candidate.imageBase64)}
                className="group relative h-full w-full overflow-hidden rounded-md border transition hover:ring-2 hover:ring-primary disabled:opacity-50"
              >
                <img
                  src={`data:image/jpeg;base64,${candidate.imageBase64}`}
                  alt={`Frame at ${formatDuration(candidate.timestampSeconds)}`}
                  className="h-full w-full object-cover"
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
