import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

// CUSTOM is a sentinel string, not a real preset — Radix's <Select> value
// can't be "" (that's reserved to mean "no value"), same convention as
// SequenceNumberField's NO_SEQUENCE.
const CUSTOM = "custom"

interface PresetOrCustomNumberFieldProps {
  id?: string
  value: number
  onChange: (value: number) => void
  presets: number[]
  min?: number
  disabled?: boolean
  className?: string
}

// A Select of common values plus a "Custom…" option that reveals a free
// number Input — for settings where most users want one of a handful of
// round numbers, but nothing stops someone from typing something else.
export function PresetOrCustomNumberField({
  id,
  value,
  onChange,
  presets,
  min,
  disabled,
  className,
}: PresetOrCustomNumberFieldProps) {
  // Once the user explicitly opens the custom input, keep showing it even
  // if they type a value that happens to match a preset — switching back to
  // the Select mid-keystroke would be jarring. Only reset when a preset is
  // picked directly from the dropdown.
  const [customMode, setCustomMode] = useState(!presets.includes(value))

  return (
    <div className={cn("flex gap-2", className)}>
      <Select
        value={customMode ? CUSTOM : String(value)}
        onValueChange={(v) => {
          if (v === CUSTOM) {
            setCustomMode(true)
          } else {
            setCustomMode(false)
            onChange(Number(v))
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger id={customMode ? undefined : id} className={customMode ? "w-32" : "w-full"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {presets.map((p) => (
            <SelectItem key={p} value={String(p)}>
              {p}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>Custom…</SelectItem>
        </SelectContent>
      </Select>
      {customMode && (
        <Input
          id={id}
          type="number"
          min={min}
          className="flex-1"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
        />
      )}
    </div>
  )
}
