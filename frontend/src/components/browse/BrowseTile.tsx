import { Link } from "react-router-dom"
import { Music } from "lucide-react"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { useRevealAll } from "@/components/library/RevealAllContext"
import { mediaFileUrl } from "@/lib/api"
import { hashText } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"

// A poster tile for the Browse page's rows — stripped of every management
// affordance LibraryCard has (no checkbox, no actions menu, no details
// panel), just art + title, since Browse is a watch surface not a manage
// surface. Clicking always goes to /browse/:id, never /library/:id.
export function BrowseTile({ item }: { item: LibraryItem }) {
  const { isRevealed, toggleItem } = useRevealAll()
  const revealed = isRevealed(item.id)
  const toggleReveal = () => toggleItem(item.id)

  return (
    <div className="group w-44 shrink-0 space-y-1.5">
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
        {item.thumbnail ? (
          <BlurredThumbnail
            src={mediaFileUrl(item.thumbnail)}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            blurred={item.blurred}
            revealed={revealed}
            onToggleReveal={toggleReveal}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
        {(!item.blurred || revealed) && (
          <Link to={`/browse/${item.id}`} className="absolute inset-0" aria-label={item.title} />
        )}
      </div>
      <p className="line-clamp-2 text-xs font-medium">
        {item.blurred && !revealed ? hashText(item.title) : item.title}
      </p>
    </div>
  )
}
