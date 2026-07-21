import { BrowseTile } from "./BrowseTile"
import type { LibraryItem } from "@/types/api"

// showProgress draws each tile's watched-progress bar from
// playbackPositionSeconds/duration — only Continue Watching passes it.
// onRemoveItem, when given, adds each tile's hover "X" — only Continue
// Watching passes it, since removing an item only makes sense there.
export function BrowseRow({
  title,
  items,
  showProgress = false,
  onRemoveItem,
}: {
  title: string
  items: LibraryItem[]
  showProgress?: boolean
  onRemoveItem?: (id: number) => void
}) {
  if (items.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-2">
        {items.map((item) => (
          <BrowseTile
            key={item.id}
            item={item}
            progressFraction={
              showProgress && item.playbackPositionSeconds != null && item.duration
                ? item.playbackPositionSeconds / item.duration
                : undefined
            }
            onRemove={onRemoveItem ? () => onRemoveItem(item.id) : undefined}
          />
        ))}
      </div>
    </section>
  )
}
