import { BrowseShowTile } from "./BrowseShowTile"
import { HorizontalScroller } from "./HorizontalScroller"
import type { ShowSummary } from "@/lib/browseShows"

// Same horizontal-scroll shell as BrowseRow, sized for ShowSummary/
// BrowseShowTile instead of LibraryItem/BrowseTile — kept as its own small
// component rather than genericizing BrowseRow, since BrowseRow's
// showProgress/onRemoveItem props are LibraryItem-specific and every
// existing call site (Continue Watching, Recently Added, artist/fallback
// collection rows) stays on it unchanged.
export function BrowseShowRow({ title, shows }: { title: string; shows: ShowSummary[] }) {
  if (shows.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <HorizontalScroller className="gap-3">
        {shows.map((show) => (
          <BrowseShowTile key={show.collectionId} show={show} />
        ))}
      </HorizontalScroller>
    </section>
  )
}
