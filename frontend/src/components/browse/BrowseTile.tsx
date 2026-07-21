import { Link } from "react-router-dom"
import { Music, X } from "lucide-react"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { Button } from "@/components/ui/button"
import { useRevealAll } from "@/components/library/RevealAllContext"
import { useSettings } from "@/hooks/useSettings"
import { mediaFileUrl } from "@/lib/api"
import { hashText } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"

// A poster tile for the Browse page's rows — stripped of every management
// affordance LibraryCard has (no checkbox, no actions menu, no details
// panel), just art + title, since Browse is a watch surface not a manage
// surface. Clicking always goes to /browse/:id, never /library/:id.
// progressFraction (0-1), when given, draws a thin watched-progress bar
// along the bottom edge — only the Continue Watching row passes this.
// onRemove, when given, adds a hover-revealed "X" in the top-right corner —
// only the Continue Watching row passes this, to clear an item from itself.
export function BrowseTile({
  item,
  progressFraction,
  onRemove,
}: {
  item: LibraryItem
  progressFraction?: number
  onRemove?: () => void
}) {
  const { data: settings } = useSettings()
  const { isRevealed, toggleItem } = useRevealAll()
  const revealed = isRevealed(item.id)
  const toggleReveal = () => toggleItem(item.id)
  const effectiveBlurred = item.blurred && !settings?.browseIgnorePrivacy
  const unlocked = !effectiveBlurred || revealed
  const showProgress = progressFraction != null && unlocked

  return (
    <div className="group w-44 shrink-0 space-y-1.5">
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
        {item.thumbnail ? (
          <BlurredThumbnail
            src={mediaFileUrl(item.thumbnail)}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            blurred={effectiveBlurred}
            revealed={revealed}
            onToggleReveal={toggleReveal}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
        {unlocked && <Link to={`/browse/${item.id}`} className="absolute inset-0" aria-label={item.title} />}
        {onRemove && unlocked && (
          <Button
            type="button"
            size="icon-xs"
            title="Remove"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRemove()
            }}
            className="absolute right-1 top-1 z-10 bg-black/60 text-white opacity-0 hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X />
          </Button>
        )}
        {showProgress && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, progressFraction * 100)}%` }} />
          </div>
        )}
      </div>
      <p className="line-clamp-2 text-xs font-medium">
        {effectiveBlurred && !revealed ? hashText(item.title) : item.title}
      </p>
    </div>
  )
}
