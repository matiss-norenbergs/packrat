import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { librarySmallThumbnailUrl } from "@/lib/api"
import type { PositionEntry } from "@/lib/sequenceArrangement"
import { hashText } from "@/lib/utils"
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
export function UnsequencedItemRow({ item, positions, onJumpToPosition }: UnsequencedItemRowProps) {
  const thumbUrl = librarySmallThumbnailUrl(item)
  const hasPositions = positions.length > 0

  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed p-2">
      {thumbUrl ? (
        <BlurredThumbnail
          src={thumbUrl}
          className="h-10 w-16 shrink-0 rounded object-cover"
          blurred={item.blurred}
          revealed={false}
          onToggleReveal={() => {}}
        />
      ) : (
        <div className="h-10 w-16 shrink-0 rounded bg-muted" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.blurred ? hashText(item.title) : item.title}</p>
        {item.artistName && <p className="truncate text-xs text-muted-foreground">{item.artistName}</p>}
      </div>

      <Select onValueChange={(v) => onJumpToPosition(Number(v))}>
        <SelectTrigger className="w-44 shrink-0">
          <SelectValue placeholder="Add to sequence…" />
        </SelectTrigger>
        <SelectContent>
          {hasPositions ? (
            positions.map((p) => (
              <SelectItem key={p.position} value={String(p.position)}>
                {p.position}
                {p.occupant
                  ? ` — ${p.occupant.blurred ? hashText(p.occupant.title) : p.occupant.title}`
                  : " — empty (missing)"}
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
