import { useState, type KeyboardEvent } from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

interface TagInputProps {
  value: string[]
  onChange: (next: string[]) => void
  /** All existing tag names across the app, offered as a click-to-add dropdown while typing. */
  suggestions?: string[]
}

// A controlled chip-list editor for attaching free-form tags to a library
// item. Purely a string[] editor — no network calls here; new names don't
// need to already exist in the tags table, the backend creates them on save
// (see TagsRepo.GetOrCreateByNames).
export function TagInput({ value, onChange, suggestions = [] }: TagInputProps) {
  const [draft, setDraft] = useState("")
  const [showSuggestions, setShowSuggestions] = useState(false)

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  // Shared by both the Enter key and clicking a suggestion — clicking a
  // suggestion adds it immediately rather than just filling the text box,
  // which previously required a confusing second "press Enter to actually
  // add it" step (the native <datalist> this replaced never committed a
  // selection on its own).
  const addTag = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || value.includes(trimmed)) return
    onChange([...value, trimmed])
    setDraft("")
    setShowSuggestions(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      addTag(draft)
    } else if (e.key === "Escape") {
      setShowSuggestions(false)
    }
  }

  const filteredSuggestions = suggestions.filter(
    (s) => !value.includes(s) && s.toLowerCase().includes(draft.trim().toLowerCase()),
  )

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="rounded-full hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          placeholder="Add a tag…"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setShowSuggestions(true)
          }}
          onFocus={() => setShowSuggestions(true)}
          // Delayed so a suggestion's onMouseDown (below) fires first — a
          // plain onClick there would lose the race to this blur closing
          // the dropdown before the click registers.
          onBlur={() => setTimeout(() => setShowSuggestions(false), 100)}
          onKeyDown={handleKeyDown}
        />
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
            {filteredSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  addTag(s)
                }}
                className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
