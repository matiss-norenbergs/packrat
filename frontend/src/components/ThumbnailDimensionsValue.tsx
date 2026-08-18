import { useSettings } from "@/hooks/useSettings"
import { getThumbnailResolutionTier, RESOLUTION_TIER_CLASS } from "@/lib/resolution"
import { cn } from "@/lib/utils"

// Same thumbnail-tier coloring as ThumbnailResolutionValue, but for call
// sites that already have numeric width/height on hand (e.g. from an API
// response) instead of just an image URL — avoids an unnecessary client-side
// image load just to re-derive dimensions the caller already has.
export function ThumbnailDimensionsValue({
  width,
  height,
  className,
}: {
  width: number | null
  height: number | null
  className?: string
}) {
  const { data: settings } = useSettings()
  const resolution = width != null && height != null ? `${width}x${height}` : null
  const tier = getThumbnailResolutionTier(resolution, settings)
  return (
    <span className={cn(className, tier && RESOLUTION_TIER_CLASS[tier])}>
      {width != null && height != null ? `${width}×${height}` : "—"}
    </span>
  )
}
