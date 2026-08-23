import { useLayoutEffect, useState } from "react"
import { Bookmark, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useFetchLibraryThumbnailCandidates, useSetLibraryThumbnail } from "@/hooks/useLibrary"
import { useSaveThumbnailToGallery } from "@/hooks/useThumbnailGallery"
import { useSettings } from "@/hooks/useSettings"
import { formatDuration } from "@/lib/utils"
import type { LibraryItem, ThumbnailCandidate } from "@/types/api"

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
  12: "grid-cols-4",
  24: "grid-cols-4",
}

const GRID_COLS_COUNT: Record<number, number> = {
  2: 2,
  4: 2,
  6: 3,
  8: 4,
  12: 4,
  24: 4,
}

export function ThumbnailPickerDialog({ item, open, onOpenChange }: ThumbnailPickerDialogProps) {
  const fetchCandidates = useFetchLibraryThumbnailCandidates()
  const setThumbnail = useSetLibraryThumbnail()
  const saveToGallery = useSaveThumbnailToGallery()
  const { data: settings } = useSettings()

  // Every timestamp ever returned this dialog session, grouped by the
  // "get new frames" batch that produced it — batches[i] is what a fresh
  // random fetch generated on the i-th click. Revisiting an earlier batch
  // re-extracts its exact timestamps (never adds a new entry here); only a
  // fresh random fetch appends. Reset whenever the dialog (re)opens, since
  // this is frontend-only, ephemeral history — nothing is persisted.
  const [batches, setBatches] = useState<number[][]>([])
  const [selectedBatch, setSelectedBatch] = useState(0)
  const [displayed, setDisplayed] = useState<ThumbnailCandidate[]>([])
  // Index into `displayed` the user has clicked — null until they pick one.
  // Clicking a frame only selects it now; applying it is a separate step via
  // the Select button, so a user who just wants to save a frame to the
  // gallery (via the floating icon) never risks also changing the thumbnail
  // by mis-clicking the tile itself.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  // Layout effect, not a plain effect — resets state synchronously before
  // paint so a reopened dialog never flashes the previous session's stale
  // frames for a frame before the skeleton takes over.
  useLayoutEffect(() => {
    if (!open) return
    setBatches([])
    setDisplayed([])
    setSelectedBatch(0)
    setSelectedIndex(null)
    fetchCandidates.mutate(
      { id: item.id },
      {
        onSuccess: (data) => {
          setBatches([data.candidates.map((c) => c.timestampSeconds)])
          setDisplayed(data.candidates)
          setSelectedBatch(0)
        },
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const frameCount = settings?.thumbnailFrameCount || 4
  const gridColsClass = GRID_COLS[frameCount] || GRID_COLS[4]
  const cols = GRID_COLS_COUNT[frameCount] || GRID_COLS_COUNT[4]
  const rows = Math.ceil(frameCount / cols)
  // A large frame count (24) doesn't try to squeeze every row into the
  // dialog's max-h-[90vh] at once the way smaller counts do below — that's
  // what made 24 look cramped/unusable. Instead it gets a fixed, real 16:9
  // row height and the grid area scrolls once it has more rows than fit.
  const scrollable = frameCount > 12
  // Cap each cell at the height a true 16:9 frame would be for its column's
  // width.
  const columnWidth = `calc((95vw - 2rem - ${(cols - 1) * 0.75}rem) / ${cols})`
  const aspectCapHeight = `calc(${columnWidth} * 9 / 16)`
  // Fixed per-row height (not aspect-ratio-derived) so total grid height —
  // rows * rowHeight + gaps — always stays within the dialog's max-h-[90vh].
  // 13rem reserves space for the header, toolbar, the footer's own bar
  // (border/background/padding make it taller than a plain button row), and
  // dialog padding around the grid — measured via the actual rendered
  // chrome height (~12.6rem) plus a little slack. object-cover crops each
  // frame to fill its cell instead of letting width dictate height, which is
  // what caused a scrollbar to appear with fewer/wider columns before. With
  // few rows (e.g. 1 row for 2 frames), this budget can exceed a real video
  // frame's proportions, cropping tiles into near-squares — the smaller of
  // the two is used via min() so it only shrinks below the aspect cap on
  // short viewports.
  const budgetHeight = `calc((90vh - 13rem - ${(rows - 1) * 0.75}rem) / ${rows})`
  const rowHeight = scrollable ? aspectCapHeight : `min(${budgetHeight}, ${aspectCapHeight})`

  const handleGetNewFrames = () => {
    const exclude = batches.flat()
    const batchIndex = batches.length
    fetchCandidates.mutate(
      { id: item.id, exclude },
      {
        onSuccess: (data) => {
          setBatches((prev) => [...prev, data.candidates.map((c) => c.timestampSeconds)])
          setDisplayed(data.candidates)
          setSelectedBatch(batchIndex)
          setSelectedIndex(null)
        },
      },
    )
  }

  const handleRevisitBatch = (value: string) => {
    const index = Number(value)
    const timestamps = batches[index]
    if (!timestamps || index === selectedBatch) return
    fetchCandidates.mutate(
      { id: item.id, timestamps },
      {
        onSuccess: (data) => {
          setDisplayed(data.candidates)
          setSelectedBatch(index)
          setSelectedIndex(null)
        },
      },
    )
  }

  const handleSelectConfirm = () => {
    if (selectedIndex == null) return
    const candidate = displayed[selectedIndex]
    setThumbnail.mutate(
      { id: item.id, imageBase64: candidate.imageBase64 },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  // batches.length === 0 (not just isPending) covers the gap between the
  // layout-effect reset and the mutation's async resolution, since
  // isPending's own transition to true isn't guaranteed to land in the same
  // pre-paint tick as the state reset above.
  const isLoading = !fetchCandidates.isError && (fetchCandidates.isPending || batches.length === 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose a thumbnail</DialogTitle>
          <DialogDescription>
            {frameCount} frames pulled from across the video — pick one to use as the thumbnail, or save any frame
            straight to the gallery.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end gap-2">
          {batches.length > 1 && (
            <Select value={String(selectedBatch)} onValueChange={handleRevisitBatch} disabled={fetchCandidates.isPending}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {batches.map((_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    Frame set {i + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={handleGetNewFrames} disabled={fetchCandidates.isPending}>
            <RefreshCw className={`h-4 w-4 ${fetchCandidates.isPending ? "animate-spin" : ""}`} />
            Get {frameCount} new frames
          </Button>
        </div>

        {isLoading ? (
          <div
            className={`grid ${gridColsClass} gap-3 ${scrollable ? "max-h-[55vh] overflow-y-auto pr-1" : ""}`}
            style={{ gridAutoRows: rowHeight }}
          >
            {Array.from({ length: frameCount }).map((_, i) => (
              <Skeleton key={i} className="h-full w-full" />
            ))}
          </div>
        ) : fetchCandidates.isError ? (
          <p className="text-sm text-destructive">Failed to grab frames: {(fetchCandidates.error as Error).message}</p>
        ) : (
          <div
            className={`grid ${gridColsClass} gap-3 ${scrollable ? "max-h-[55vh] overflow-y-auto pr-1" : ""}`}
            style={{ gridAutoRows: rowHeight }}
          >
            {displayed.map((candidate, i) => (
              <button
                key={i}
                type="button"
                disabled={setThumbnail.isPending}
                onClick={() => setSelectedIndex(i)}
                className={`group relative h-full w-full overflow-hidden rounded-md border transition disabled:opacity-50 ${
                  selectedIndex === i ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/50"
                }`}
              >
                <img
                  src={`data:image/jpeg;base64,${candidate.imageBase64}`}
                  alt={`Frame at ${formatDuration(candidate.timestampSeconds)}`}
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                  {formatDuration(candidate.timestampSeconds)}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Save this frame to the gallery"
                      onClick={(e) => {
                        e.stopPropagation()
                        saveToGallery.mutate({ id: item.id, imageBase64: candidate.imageBase64 })
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return
                        e.stopPropagation()
                        e.preventDefault()
                        saveToGallery.mutate({ id: item.id, imageBase64: candidate.imageBase64 })
                      }}
                      className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1.5 text-white opacity-0 transition hover:bg-black/80 group-hover:opacity-100"
                    >
                      <Bookmark className="h-3.5 w-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Save this frame to the gallery</TooltipContent>
                </Tooltip>
              </button>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSelectConfirm} disabled={selectedIndex == null || setThumbnail.isPending}>
            Select
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
