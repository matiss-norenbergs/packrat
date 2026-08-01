import { useSettings } from "@/hooks/useSettings"
import { getResolutionTier, RESOLUTION_TIER_CLASS } from "@/lib/resolution"
import { cn } from "@/lib/utils"

// Renders a resolution string ("1920x1080") colored by the user's
// configured quality tiers (Settings > Library) — red/amber/green for
// low/medium/high, or unstyled when the resolution or settings aren't
// available (e.g. audio items, or before settings have loaded).
export function ResolutionValue({
  resolution,
  className,
}: {
  resolution: string | null | undefined
  className?: string
}) {
  const { data: settings } = useSettings()
  const tier = getResolutionTier(resolution, settings)
  return <span className={cn(className, tier && RESOLUTION_TIER_CLASS[tier])}>{resolution ?? "—"}</span>
}
