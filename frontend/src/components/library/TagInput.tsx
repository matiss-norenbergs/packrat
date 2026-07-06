import { useState, type KeyboardEvent } from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

interface TagInputProps {
  value: string[]
  onChange: (next: string[]) => void
  /** All existing tag names across the app, offered via a native <datalist>. */
  suggestions?: string[]
}

// A controlled chip-list editor for attaching free-form tags to a library
// item. Purely a string[] editor — no network calls here; new names don't
// need to already exist in the tags table, the backend creates them on save
// (see TagsRepo.GetOrCreateByNames).
export function TagInput({ value, onChange, suggestions = [] }: TagInputProps) {
  const [draft, setDraft] = useState("")

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  const addTag = () => {
    const trimmed = draft.trim()
    if (!trimmed || value.includes(trimmed)) return
    onChange([...value, trimmed])
    setDraft("")
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      addTag()
    }
  }

  const datalistOptions = suggestions.filter((s) => !value.includes(s))

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
      <Input
        list="tag-suggestions"
        placeholder="Add a tag…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <datalist id="tag-suggestions">
        {datalistOptions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}
