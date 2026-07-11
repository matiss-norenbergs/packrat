import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useArtists } from "@/hooks/useArtists"

// NO_ARTIST is a sentinel string, not a real artist id — Radix's <Select>
// value can't be "" (that's reserved to mean "no value"), and this needs to
// round-trip through a plain string-keyed value prop just like the
// Collection picker's NO_COLLECTION sentinel does.
export const NO_ARTIST = "none"

interface ArtistSelectProps {
  value: string
  onValueChange: (value: string) => void
}

// Artist is deliberately Select-only — no free-text entry, no inline
// "create new" shortcut. Artists are only ever created on the Artists page;
// this picker just chooses among ones that already exist.
export function ArtistSelect({ value, onValueChange }: ArtistSelectProps) {
  const { data: artists } = useArtists()

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_ARTIST}>None</SelectItem>
        {artists?.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
