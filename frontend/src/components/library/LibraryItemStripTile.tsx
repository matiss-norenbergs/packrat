import { Link } from "react-router-dom"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { mediaFileUrl } from "@/lib/api"
import { formatDuration, hashText } from "@/lib/utils"
import { useRevealAll } from "./RevealAllContext"
import type { LibraryItem } from "@/types/api"

// backTo is forwarded from the current item page's own "from" state (not
// recomputed here) so that clicking through several siblings still returns
// to the original library listing, not to whichever sibling was viewed
// previously. basePath lets this tile stay within whichever detail route
// it's rendered under ("/library" from the management chrome, "/browse"
// from the Browse chrome) instead of always jumping back into /library.
// ignorePrivacy mirrors LibraryItemDetail's prop of the same name — only
// forwarded from the Browse chrome, never from Library.
export function LibraryItemStripTile({
  item,
  backTo,
  basePath = "/library",
  ignorePrivacy = false,
}: {
  item: LibraryItem
  backTo: string
  basePath?: string
  ignorePrivacy?: boolean
}) {
  const { isRevealed, toggleItem } = useRevealAll()
  const revealed = isRevealed(item.id)
  const toggleReveal = () => toggleItem(item.id)
  const effectiveBlurred = item.blurred && !ignorePrivacy

  return (
    <div className="w-40 shrink-0 space-y-1.5">
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
        {item.thumbnail ? (
          <BlurredThumbnail
            src={mediaFileUrl(item.thumbnail)}
            className="absolute inset-0 h-full w-full object-cover"
            blurred={effectiveBlurred}
            revealed={revealed}
            onToggleReveal={toggleReveal}
          />
        ) : null}
        {!effectiveBlurred || revealed ? (
          <Link to={`${basePath}/${item.id}`} state={{ from: backTo }} className="absolute inset-0" aria-label={item.title} />
        ) : null}
        {item.duration != null && (
          <span className="absolute bottom-1 right-1 rounded bg-background/80 px-1 text-[10px] text-foreground">
            {formatDuration(item.duration)}
          </span>
        )}
      </div>
      {effectiveBlurred && !revealed ? (
        <p className="line-clamp-2 text-xs font-medium">{hashText(item.title)}</p>
      ) : (
        <Link
          to={`${basePath}/${item.id}`}
          state={{ from: backTo }}
          className="line-clamp-2 block text-xs font-medium hover:underline"
        >
          {item.title}
        </Link>
      )}
    </div>
  )
}
