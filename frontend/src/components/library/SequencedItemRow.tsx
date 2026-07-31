import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { PositionEntry } from "@/lib/sequenceArrangement"
import { cn } from "@/lib/utils"
import { BlurredItemThumbnail } from "./BlurredItemThumbnail"
import type { LibraryItem } from "@/types/api"

interface SequencedItemRowProps {
  item: LibraryItem
  displayNumber: number
  rowNumber: number
  positions: PositionEntry[]
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onJumpToPosition: (position: number) => void
}

export function SequencedItemRow({
  item,
  displayNumber,
  rowNumber,
  positions,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onJumpToPosition,
}: SequencedItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-3 rounded-md border p-2",
        rowNumber % 2 === 0 && "bg-muted/40",
        isDragging && "opacity-50",
      )}
    >
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex flex-col">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-4"
            disabled={!canMoveUp}
            onClick={onMoveUp}
            aria-label="Move up"
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-4"
            disabled={!canMoveDown}
            onClick={onMoveDown}
            aria-label="Move down"
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="flex w-10 shrink-0 items-center justify-center text-lg font-semibold tabular-nums">
        {displayNumber}
      </div>

      <BlurredItemThumbnail item={item} className="h-10 w-16" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        {item.artistName && <p className="truncate text-xs text-muted-foreground">{item.artistName}</p>}
      </div>

      <Select value={String(displayNumber)} onValueChange={(v) => onJumpToPosition(Number(v))}>
        {/* Explicit children on SelectValue overrides Radix's default of
            mirroring the matched SelectItem's full "position — title" text
            — the collapsed trigger only needs the (at most 4-digit) number,
            the full text is still there once the dropdown is open. */}
        <SelectTrigger className="w-20 shrink-0 tabular-nums">
          <SelectValue>{displayNumber}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {positions.map((p) => (
            <SelectItem key={p.position} value={String(p.position)}>
              {p.position}
              {p.occupant && p.occupant.id !== item.id
                ? ` — ${p.occupant.title}`
                : p.occupant === null
                  ? " — empty (missing)"
                  : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
