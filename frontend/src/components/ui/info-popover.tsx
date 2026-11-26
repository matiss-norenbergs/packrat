import type { ReactNode } from "react"
import { Info } from "lucide-react"
import { Label } from "@/components/ui/label"
import { TOUCH_HIT_AREA } from "@/lib/touchTarget"
import { useHoverPopover } from "@/lib/useHoverPopover"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// A small info icon opening a popover with explanatory text on hover (mouse)
// or tap (touch) — replaces an always-visible hint paragraph below a field,
// so the form reads shorter at a glance while the explanation stays one
// hover or tap away. Popover has no built-in hover mode, so `useHoverPopover`
// drives it for a mouse pointer only (a tap would otherwise open it through
// the compatibility mouseenter and the click would close it again); both the
// trigger and the content need the handlers, or moving the mouse off the
// small icon onto the content would close it. On touch the tap area grows
// to 44 px (`TOUCH_HIT_AREA`) while the 14 px icon and the layout stay put.
export function InfoPopover({ children }: { children: ReactNode }) {
  const { open, onOpenChange, hoverProps } = useHoverPopover()
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("text-muted-foreground transition hover:text-foreground", TOUCH_HIT_AREA)}
          aria-label="More info"
          {...hoverProps}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label="More info"
        className="text-xs text-muted-foreground"
        {...hoverProps}
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
