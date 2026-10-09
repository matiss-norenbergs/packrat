import { useLayoutEffect, useRef, useState } from "react"
import { Bookmark, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSetLibraryThumbnail } from "@/hooks/useLibrary"
import { useSaveThumbnailToGallery } from "@/hooks/useThumbnailGallery"
import { useSettings } from "@/hooks/useSettings"
import { fetchLibraryThumbnailCandidates, fetchLibraryThumbnailTimestamps } from "@/lib/api"
import { formatDuration } from "@/lib/utils"
import type { LibraryItem, ThumbnailCandidate } from "@/types/api"
import type { ThumbnailPickOptions } from "./ThumbnailCustomRangeDialog"

interface ThumbnailPickerDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
  // Per-run frame count / pick range ("Choose from Video (custom)…"). Absent
  // means use the Settings values, which the backend resolves itself.
  options?: ThumbnailPickOptions
}

// Literal class strings, not a "grid-cols-" + n template — Tailwind's
// build-time class scanner only picks up whole strings it can find verbatim.
const GRID_COLS_CLASS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
}

// Column count for n frames: 2 up to 4 frames, 3 for 5-6, 4 beyond that.
function gridColumns(n: number): number {
  if (n <= 4) return 2
  if (n <= 6) return 3
  return 4
}

export function ThumbnailPickerDialog({ item, open, onOpenChange, options }: ThumbnailPickerDialogProps) {
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
  // Non-null exactly while a batch is being extracted; `done` counts frames
  // attempted (including any that failed and were skipped).
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped on every new load and when the dialog closes, so a superseded
  // loop notices it's stale and stops (at most one in-flight request is
  // wasted).
  const runId = useRef(0)

  const cancelLoad = () => {
    runId.current++
  }

  const configuredCount =options?.count ?? settings?.thumbnailFrameCount ?? 4

  // Picks the batch's timestamps (unless the caller already has them), then
  // extracts the frames one request at a time so the progress bar reflects
  // real work and tiles appear as they arrive. A frame that fails to extract
  // is skipped, matching the old all-at-once endpoint; it only counts as an
  // error if none came back. onLoaded gets the finished batch.
  const loadBatch = async (
    plan: { timestamps?: number[]; exclude?: number[] },
    onLoaded: (candidates: ThumbnailCandidate[]) => void,
  ) => {
    const run = ++runId.current
    const stale = () => run !== runId.current
    setError(null)
    setDisplayed([])
    setSelectedIndex(null)
    setProgress({ done: 0, total: plan.timestamps?.length ?? configuredCount })
    try {
      let timestamps = plan.timestamps
      if (!timestamps) {
        const picked = await fetchLibraryThumbnailTimestamps(item.id, {
          count: options?.count,
          low: options?.low,
          high: options?.high,
          exclude: plan.exclude,
        })
        if (stale()) return
        timestamps = picked.timestamps
        setProgress({ done: 0, total: timestamps.length })
      }

      const got: ThumbnailCandidate[] = []
      let lastError = ""
      for (let i = 0; i < timestamps.length; i++) {
        try {
          const { candidates } = await fetchLibraryThumbnailCandidates(item.id, { timestamps: [timestamps[i]] })
          if (stale()) return
          got.push(...candidates)
          setDisplayed([...got])
        } catch (err) {
          if (stale()) return
          lastError = (err as Error).message
        }
        setProgress({ done: i + 1, total: timestamps.length })
      }
      if (got.length === 0) {
        throw new Error(lastError || "couldn't extract any frames — this file may not contain a video stream")
      }
      onLoaded(got)
    } catch (err) {
      if (stale()) return
      const message = (err as Error).message
      setError(message)
      toast.error(`Failed to grab frames: ${message}`)
    } finally {
      if (!stale()) setProgress(null)
    }
  }

  // Layout effect, not a plain effect — resets state synchronously before
  // paint so a reopened dialog never flashes the previous session's stale
  // frames for a frame before the progress state takes over.
  useLayoutEffect(() => {
    if (!open) return
    setBatches([])
    setSelectedBatch(0)
    void loadBatch({}, (candidates) => {
      setBatches([candidates.map((c) => c.timestampSeconds)])
      setSelectedBatch(0)
    })
    return cancelLoad
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const isLoading = progress != null
  const frameCount = isLoading ? progress.total : displayed.length || configuredCount
  const cols = gridColumns(frameCount)
  const gridColsClass = GRID_COLS_CLASS[cols]
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
    void loadBatch({ exclude }, (candidates) => {
      setBatches((prev) => [...prev, candidates.map((c) => c.timestampSeconds)])
      setSelectedBatch(batchIndex)
    })
  }

  const handleRevisitBatch = (value: string) => {
    const index = Number(value)
    const timestamps = batches[index]
    if (!timestamps || index === selectedBatch) return
    void loadBatch({ timestamps }, () => setSelectedBatch(index))
  }

  const handleSelectConfirm = () => {
    if (selectedIndex == null) return
    const candidate = displayed[selectedIndex]
    setThumbnail.mutate(
      { id: item.id, imageBase64: candidate.imageBase64 },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const pendingTiles = progress ? Math.max(progress.total - progress.done, 0) : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose a thumbnail</DialogTitle>
          <DialogDescription>
            {configuredCount} frames pulled from{" "}
            {options ? `${options.low}%–${options.high}% of the video` : "across the video"} — pick one to use as the
            thumbnail, or save any frame straight to the gallery.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end gap-2">
          {progress && (
            <div className="mr-auto flex min-w-0 flex-1 items-center gap-3">
              <Progress value={percent} className="h-2" />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {progress.done} / {progress.total} ({percent}%)
              </span>
            </div>
          )}
          {batches.length > 1 && (
            <Select value={String(selectedBatch)} onValueChange={handleRevisitBatch} disabled={isLoading}>
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
          <Button variant="outline" size="sm" onClick={handleGetNewFrames} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Get {configuredCount} new frames
          </Button>
        </div>

        {error && !isLoading && displayed.length === 0 ? (
          <p className="text-sm text-destructive">Failed to grab frames: {error}</p>
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
            {Array.from({ length: pendingTiles }).map((_, i) => (
              <Skeleton key={`pending-${i}`} className="h-full w-full" />
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
