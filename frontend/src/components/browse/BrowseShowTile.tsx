import { Link } from "react-router-dom"
import { ImageIcon } from "lucide-react"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { useRevealAll } from "@/components/library/RevealAllContext"
import { useSettings } from "@/hooks/useSettings"
import { cn, hashText } from "@/lib/utils"
import type { ShowSummary } from "@/lib/browseShows"

// RevealAllContext's reveal set is keyed by plain number and was built for
// library item ids — negating the collection id keeps show tiles in a
// disjoint key space so a show and a library item can never collide on the
// same numeric key (both id spaces start at 1, never 0).
function revealKeyFor(collectionId: number): number {
  return -collectionId
}

// A title's longest unbroken word — not its total length — is what actually
// risks overflowing the tile, since normal multi-word titles already wrap at
// spaces (and get clipped by line-clamp). Scaling the font down as that
// longest word grows keeps ordinary short titles at full size while a
// single long word (no spaces to break on) shrinks just enough to fit
// instead of spilling past the tile edge.
function titleSizeClass(name: string): string {
  const longestWord = Math.max(...name.split(/\s+/).map((w) => w.length))
  if (longestWord <= 8) return "text-3xl"
  if (longestWord <= 12) return "text-2xl"
  if (longestWord <= 16) return "text-xl"
  if (longestWord <= 22) return "text-lg"
  return "text-base"
}

// The Netflix-style show/album tile — cover fills the tile, name overlaid
// centered on the image over a dark scrim, unlike BrowseTile's caption-below
// treatment. Links to the show's season/episode listing page, never
// straight to a player. Respects the same private-collection blur/reveal
// pattern as BrowseTile, keyed by a disjoint id space (see revealKeyFor).
export function BrowseShowTile({ show }: { show: ShowSummary }) {
  const { data: settings } = useSettings()
  const { isRevealed, toggleItem } = useRevealAll()
  const revealKey = revealKeyFor(show.collectionId)
  const revealed = isRevealed(revealKey)
  const toggleReveal = () => toggleItem(revealKey)
  const effectiveBlurred = show.isPrivate && !settings?.browseIgnorePrivacy
  const unlocked = !effectiveBlurred || revealed

  return (
    <div className="group w-44 shrink-0 space-y-1.5">
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
        {show.coverUrlSmall ? (
          <BlurredThumbnail
            src={show.coverUrlSmall}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            blurred={effectiveBlurred}
            revealed={revealed}
            onToggleReveal={toggleReveal}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-black/40" />
        {unlocked && (
          <Link to={`/browse/collection/${show.collectionId}`} className="absolute inset-0" aria-label={show.name} />
        )}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-2">
          <p
            className={cn(
              "line-clamp-2 break-words text-center font-semibold text-white drop-shadow-md",
              titleSizeClass(show.name),
            )}
          >
            {effectiveBlurred && !revealed ? hashText(show.name) : show.name}
          </p>
        </div>
      </div>
    </div>
  )
}
