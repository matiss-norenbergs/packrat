import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

interface SequenceGapMarkerProps {
  count: number
  onIncrement: () => void
  onDecrement: () => void
}

// A reserved-but-empty span of sequence numbers, rendered before whichever
// item it's attached to (or before the whole list, for the leading gap).
// Auto-seeded from real data on open, then freely adjustable — this is what
// keeps a legitimate gap (an undownloaded episode) visible and intact
// instead of silently collapsed by reordering.
export function SequenceGapMarker({ count, onIncrement, onDecrement }: SequenceGapMarkerProps) {
  return (
    <div className="ml-9 flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
      <span className="flex-1">
        {count} missing sequence number{count === 1 ? "" : "s"}
      </span>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onDecrement} aria-label="Reserve one fewer slot">
        <Minus className="h-3 w-3" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onIncrement} aria-label="Reserve one more slot">
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  )
}

// A thin "+" affordance to manually start a new gap where none exists yet —
// rendered between/after rows that don't currently have one.
export function SequenceGapInsertButton({ onInsert }: { onInsert: () => void }) {
  return (
    <div className="ml-9 flex h-2 items-center">
      <button
        type="button"
        onClick={onInsert}
        aria-label="Reserve a missing sequence number here"
        className="h-2 w-full rounded opacity-0 transition hover:bg-muted/60 hover:opacity-100"
      />
    </div>
  )
}
