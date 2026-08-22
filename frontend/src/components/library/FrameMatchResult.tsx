import { useState } from "react"
import { Bookmark } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ImageCompareSliderDialog } from "@/components/thumbnailenhance/ImageCompareSliderDialog"
import { ThumbnailResolutionValue } from "@/components/ThumbnailResolutionValue"
import { useSaveThumbnailToGalleryFromUrl } from "@/hooks/useThumbnailGallery"
import { formatDuration } from "@/lib/utils"

interface FrameMatchResultProps {
  libraryItemId: number
  referenceUrl: string
  foundUrl: string
  timestampSeconds: number | null
  score: number
  itemTitle: string
}

// scoreVariant maps the 0-100 confidence score to a badge severity —
// benchmarking (cmd/framematch-bench) showed misses can still score in the
// 70-80s, so this is a rough steer rather than a hard cutoff; the actual
// side-by-side images are what the user judges by.
function scoreVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 85) return "default"
  if (score >= 65) return "secondary"
  return "destructive"
}

// FrameMatchResult renders a completed match's side-by-side comparison,
// confidence badge, and click-to-open fullscreen slider — shared by the
// single-item FrameMatchDialog and the bulk Frame Matching page's review
// view, so both present the exact same result the same way.
export function FrameMatchResult({ libraryItemId, referenceUrl, foundUrl, timestampSeconds, score, itemTitle }: FrameMatchResultProps) {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const saveToGallery = useSaveThumbnailToGalleryFromUrl()

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Reference</p>
          <div className="group relative overflow-hidden rounded-md border">
            <img
              src={referenceUrl}
              alt="Reference thumbnail"
              onClick={() => setOverlayOpen(true)}
              title="Click to compare"
              className="h-[60vh] w-full cursor-zoom-in object-contain"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Save to gallery"
                  disabled={saveToGallery.isPending}
                  onClick={() => saveToGallery.mutate({ id: libraryItemId, url: referenceUrl })}
                  className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1.5 text-white opacity-0 transition hover:bg-black/90 group-hover:opacity-100 disabled:opacity-50"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Save to gallery</TooltipContent>
            </Tooltip>
          </div>
          <ThumbnailResolutionValue src={referenceUrl} className="text-xs text-muted-foreground" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Frame at {formatDuration(timestampSeconds)}</p>
          <div className="group relative overflow-hidden rounded-md border">
            <img
              src={foundUrl}
              alt="Matched frame"
              onClick={() => setOverlayOpen(true)}
              title="Click to compare"
              className="h-[60vh] w-full cursor-zoom-in object-contain"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Save to gallery"
                  disabled={saveToGallery.isPending}
                  onClick={() => saveToGallery.mutate({ id: libraryItemId, url: foundUrl })}
                  className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1.5 text-white opacity-0 transition hover:bg-black/90 group-hover:opacity-100 disabled:opacity-50"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Save to gallery</TooltipContent>
            </Tooltip>
          </div>
          <ThumbnailResolutionValue src={foundUrl} className="text-xs text-muted-foreground" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={scoreVariant(score)}>{Math.round(score)}% confidence</Badge>
        {score < 65 && <span className="text-xs text-muted-foreground">This may not be the source frame</span>}
      </div>

      <ImageCompareSliderDialog
        open={overlayOpen}
        onOpenChange={setOverlayOpen}
        originalUrl={referenceUrl}
        enhancedUrl={foundUrl}
        itemTitle={itemTitle}
        leftLabel="Reference"
        rightLabel="Found frame"
      />
    </>
  )
}
