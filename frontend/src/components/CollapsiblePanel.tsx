import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface CollapsiblePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Used to build the notch button's aria-label ("Collapse {label}" /
  // "Expand {label}"), e.g. "artist images panel" or "collection details
  // panel".
  label: string
  children: React.ReactNode
}

// The right-side notch-toggle panel shared by list pages (Artists,
// Collections): a small handle that slides a bordered w-80 panel in or out
// of the gap next to the main content. Open state isn't owned here — the
// caller's outer layout usually needs the same boolean to animate its own
// gap between the main column and this panel, so it stays lifted (typically
// via usePersistedOpen).
export function CollapsiblePanel({ open, onOpenChange, label, children }: CollapsiblePanelProps) {
  return (
    <div className="relative min-h-0 shrink-0">
      {/* A small notch handle rather than a full-height strip. Open: sits on
          the panel's outer left side (right edge of the notch flush with the
          panel's left edge, sticking out into the gap — not overlapping the
          panel's own bordered content). Collapsed: the wrapper it's anchored
          to has shrunk to zero width, so its left/right edge is wherever
          main's own right padding starts — offsetting by that exact padding
          (-right-4 / md:-right-6, matching AppLayout's p-4/md:p-6) pushes the
          notch the rest of the way to sit flush against the actual viewport
          edge instead of floating mid-gap. */}
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
        className={cn(
          "absolute top-1/2 z-10 flex h-14 w-5 -translate-y-1/2 items-center justify-center rounded-l-md border border-r-0 bg-background text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground",
          open ? "-left-5" : "-right-4 md:-right-6",
        )}
      >
        {open ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>

      <div
        className={cn(
          "h-full min-h-0 overflow-hidden transition-[width] duration-300 ease-in-out",
          open ? "w-80" : "w-0",
        )}
      >
        {/* No right padding — main's own page-level p-4/md:p-6 already
            provides that margin out to the viewport edge, so adding the
            panel's own would double it up. */}
        <div className="h-full w-80 min-h-0 overflow-y-auto border-l py-4 pl-4 md:py-6 md:pl-6">{children}</div>
      </div>
    </div>
  )
}
