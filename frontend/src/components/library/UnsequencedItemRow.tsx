import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { PositionEntry } from "@/lib/sequenceArrangement"
import { BlurredItemThumbnail } from "./BlurredItemThumbnail"
import type { LibraryItem } from "@/types/api"

interface UnsequencedItemRowProps {
  item: LibraryItem
  positions: PositionEntry[]
  onJumpToPosition: (position: number) => void
}

// No sequence number yet, no drag handle or arrows (there's nowhere to
// reorder to until it's placed) — just thumbnail/title and the same
// jump-to-position select every sequenced row has. Picking a position here
// is what moves the item into the sequenced list.
//
// Layout flips with the dialog's own breakpoint: below lg, this section is
// full-width at the bottom of the dialog, so thumbnail/title/select fit
// comfortably in one row (select docked to the right, as it always was).
// At lg+, EditSequenceDialog moves this into a narrow right-hand column
// instead — there, thumbnail+title+select side by side doesn't leave the
// title enough room to show anything before truncating to nothing, so it
// stacks (thumbnail+title on their own row, select full-width below).
export function UnsequencedItemRow({ item, positions, onJumpToPosition }: UnsequencedItemRowProps) {
  const hasPositions = positions.length > 0

  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed p-2 lg:flex-col lg:items-stretch lg:gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-3 lg:flex-none">
        <BlurredItemThumbnail item={item} className="h-10 w-16" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.title}</p>
          {item.artistName && <p className="truncate text-xs text-muted-foreground">{item.artistName}</p>}
        </div>
      </div>

      <Select onValueChange={(v) => onJumpToPosition(Number(v))}>
        <SelectTrigger className="w-44 shrink-0 lg:w-full">
          <SelectValue placeholder="Add to sequence…" />
        </SelectTrigger>
        <SelectContent>
          {hasPositions ? (
            positions.map((p) => (
              <SelectItem key={p.position} value={String(p.position)}>
                {p.position}
                {p.occupant ? ` — ${p.occupant.title}` : " — empty (missing)"}
              </SelectItem>
            ))
          ) : (
            <SelectItem value="1">1 — start the sequence</SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
