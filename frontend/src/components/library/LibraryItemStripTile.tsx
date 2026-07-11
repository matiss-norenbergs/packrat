import { Link } from "react-router-dom"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { mediaFileUrl } from "@/lib/api"
import { formatDuration, hashText } from "@/lib/utils"
import { useRevealAll } from "./RevealAllContext"
import type { LibraryItem } from "@/types/api"

export function LibraryItemStripTile({ item }: { item: LibraryItem }) {
  const { isRevealed, toggleItem } = useRevealAll()
  const revealed = isRevealed(item.id)
  const toggleReveal = () => toggleItem(item.id)

  return (
    <div className="w-40 shrink-0 space-y-1.5">
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
        {item.thumbnail ? (
          <BlurredThumbnail
            src={mediaFileUrl(item.thumbnail)}
            className="absolute inset-0 h-full w-full object-cover"
            blurred={item.blurred}
            revealed={revealed}
            onToggleReveal={toggleReveal}
          />
        ) : null}
        {!item.blurred || revealed ? (
          <Link to={`/library/${item.id}`} className="absolute inset-0" aria-label={item.title} />
        ) : null}
        {item.duration != null && (
          <span className="absolute bottom-1 right-1 rounded bg-background/80 px-1 text-[10px] text-foreground">
            {formatDuration(item.duration)}
          </span>
        )}
      </div>
      {item.blurred && !revealed ? (
        <p className="line-clamp-2 text-xs font-medium">{hashText(item.title)}</p>
      ) : (
        <Link to={`/library/${item.id}`} className="line-clamp-2 block text-xs font-medium hover:underline">
          {item.title}
        </Link>
      )}
    </div>
  )
}
