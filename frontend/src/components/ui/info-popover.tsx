import { useState, type ReactNode } from "react"
import { Info } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// A small info icon opening a popover with explanatory text on hover —
// replaces an always-visible hint paragraph below a field, so the form reads
// shorter at a glance while the explanation stays one hover away. Popover
// has no built-in hover mode, so open/close is driven manually here — both
// the trigger and the content itself need the enter/leave handlers, or
// moving the mouse off the small icon and onto the content would
// immediately close it.
export function InfoPopover({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground transition hover:text-foreground"
          aria-label="More info"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="text-xs text-muted-foreground"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

// A Label paired with an InfoPopover on its right — the standard field-label
// shape used wherever a field's help text moved from a paragraph into a
// hover popover.
export function FieldLabel({ htmlFor, children, info }: { htmlFor: string; children: ReactNode; info: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor}>{children}</Label>
      <InfoPopover>{info}</InfoPopover>
    </div>
  )
}
