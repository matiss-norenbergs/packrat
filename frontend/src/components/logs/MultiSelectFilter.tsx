import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export interface MultiSelectOption {
  value: string
  label: string
  count?: number
}

interface MultiSelectFilterProps {
  /** Shown on the button ("Level", "Category"); a count is appended while something is selected. */
  label: string
  options: MultiSelectOption[]
  selected: string[]
  onChange: (selected: string[]) => void
}

// A button opening a menu of checkboxes. The menu stays open while ticking, so several values can be picked in one go.
export function MultiSelectFilter({ label, options, selected, onChange }: MultiSelectFilterProps) {
  const toggle = (value: string, on: boolean) => onChange(on ? [...selected, value] : selected.filter((v) => v !== value))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between gap-2 sm:w-auto" aria-label={label}>
          {selected.length > 0 ? `${label} (${selected.length})` : label}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {options.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Nothing to filter by yet</p>}
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={selected.includes(opt.value)}
            onCheckedChange={(on) => toggle(opt.value, on === true)}
            onSelect={(e) => e.preventDefault()}
          >
            <span className="capitalize">{opt.label}</span>
            {opt.count != null && <span className="ml-auto pl-3 text-xs text-muted-foreground">{opt.count}</span>}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
