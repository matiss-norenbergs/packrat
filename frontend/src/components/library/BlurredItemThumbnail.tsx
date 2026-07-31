import { useState } from "react"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { librarySmallThumbnailUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"

interface BlurredItemThumbnailProps {
  item: LibraryItem
  className?: string
}

// A small thumbnail with its own local click-to-reveal state — for the
// short-lived preview lists in bulk-action/sequence-editing dialogs, which
// don't share the main Library grid's global RevealAllContext (each dialog
// closes/reopens fresh, so there's nothing worth persisting reveal state
// against). overflow-hidden on this wrapper is load-bearing: without it,
// the blur filter isn't clipped to the thumbnail's rounded corners and
// bleeds into the row around it.
export function BlurredItemThumbnail({ item, className }: BlurredItemThumbnailProps) {
  const [revealed, setRevealed] = useState(false)
  const thumbUrl = librarySmallThumbnailUrl(item)

  if (!thumbUrl) return <div className={cn("shrink-0 rounded bg-muted", className)} />

  return (
    <div className={cn("shrink-0 overflow-hidden rounded", className)}>
      <BlurredThumbnail
        src={thumbUrl}
        className="h-full w-full object-cover"
        blurred={item.blurred}
        revealed={revealed}
        onToggleReveal={() => setRevealed((v) => !v)}
      />
    </div>
  )
}
