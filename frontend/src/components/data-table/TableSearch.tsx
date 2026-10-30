import { useEffect, useRef, useState } from "react"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { SearchConfig } from "./types"

// The input updates immediately; onChange (what the page filters on) is debounced so fast
// typing doesn't re-filter/re-paginate on every keystroke. Clearing applies immediately.
export function TableSearch({
  value,
  onChange,
  placeholder = "Search…",
  debounceMs = 300,
  className,
}: SearchConfig & { className?: string }) {
  const [input, setInput] = useState(value)
  const [prevValue, setPrevValue] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  // Follow an external reset (e.g. the page clearing its filters) unless a debounced edit is still pending.
  if (value !== prevValue) {
    setPrevValue(value)
    if (timer.current == null) setInput(value)
  }

  const cancelPending = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const handleChange = (next: string) => {
    setInput(next)
    cancelPending()
    timer.current = setTimeout(() => {
      timer.current = null
      onChangeRef.current(next)
    }, debounceMs)
  }

  return (
    <div className={cn("relative min-w-[160px] max-w-[280px] flex-1 sm:min-w-[200px]", className)}>
      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        className="pl-8 pr-7"
        value={input}
        onChange={(e) => handleChange(e.target.value)}
      />
      {input && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Clear search"
          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => {
            cancelPending()
            setInput("")
            onChange("")
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
