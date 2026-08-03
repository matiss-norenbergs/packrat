import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

// NO_SEQUENCE is a sentinel string, not a real sequence number — Radix's
// <Select> value can't be "" (that's reserved to mean "no value"), same
// convention as ArtistSelect's NO_ARTIST.
export const NO_SEQUENCE = "none"

interface SequenceNumberFieldProps {
  id?: string
  value: string // "" = none, else a numeric string — same convention as every other edit field
  onChange: (value: string) => void
  // The item's collection's configured Sequence Max, if any. Once set, this
  // renders a min..max + None picker instead of a free number input —
  // knowing the max means every valid position is enumerable, and picking
  // from a list also surfaces which positions exist without a separate hint.
  sequenceMax: number | null | undefined
  // The collection's configured Sequence Min, if any — defaults to 1.
  // Covers collections whose real numbering doesn't start at 1: the picker's
  // option list (when sequenceMax is set) and the plain input's HTML `min`
  // (when it isn't) both start here instead of always at 1.
  sequenceMin?: number | null | undefined
  // Passed straight through to whichever control renders — lets a caller
  // reserve space (e.g. pr-8) for an addon button overlaid on top.
  className?: string
}

export function SequenceNumberField({ id, value, onChange, sequenceMax, sequenceMin, className }: SequenceNumberFieldProps) {
  const min = sequenceMin ?? 1

  if (sequenceMax != null && sequenceMax >= min) {
    const options = Array.from({ length: sequenceMax - min + 1 }, (_, i) => min + i)
    return (
      <Select value={value === "" ? NO_SEQUENCE : value} onValueChange={(v) => onChange(v === NO_SEQUENCE ? "" : v)}>
        <SelectTrigger id={id} className={cn("w-full", className)}>
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_SEQUENCE}>None</SelectItem>
          {options.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <Input
      id={id}
      type="number"
      min={min}
      placeholder="e.g. 1"
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
