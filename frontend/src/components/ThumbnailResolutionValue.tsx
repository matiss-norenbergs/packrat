import { useEffect, useState } from "react"
import { useSettings } from "@/hooks/useSettings"
import { getThumbnailResolutionTier, RESOLUTION_TIER_CLASS } from "@/lib/resolution"
import { cn } from "@/lib/utils"

// Loads the source thumbnail image client-side to read its pixel
// dimensions — the backend has no width/height column for thumbnails, and
// probing it server-side on every list/card render would be wasteful when
// the browser already fetches the image to display it elsewhere on the page.
// Colored by the separate thumbnail resolution tier (Settings > Library) —
// mirrors ResolutionValue's video-tier coloring, but against its own
// lower-default thresholds since a thumbnail's practical range is much
// narrower than a video's.
export function ThumbnailResolutionValue({ src, className }: { src: string | null; className?: string }) {
  const { data: settings } = useSettings()
  const [resolution, setResolution] = useState<string | null>(null)

  useEffect(() => {
    setResolution(null)
    if (!src) return
    const img = new Image()
    img.onload = () => setResolution(`${img.naturalWidth}x${img.naturalHeight}`)
    img.src = src
    return () => {
      img.onload = null
    }
  }, [src])

  const tier = getThumbnailResolutionTier(resolution, settings)
  return <span className={cn(className, tier && RESOLUTION_TIER_CLASS[tier])}>{resolution ?? "—"}</span>
}
