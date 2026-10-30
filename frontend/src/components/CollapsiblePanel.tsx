import { useLayoutEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePersistedWidth } from "@/hooks/usePersistedWidth"

interface CollapsiblePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Used to build the notch button's aria-label ("Collapse {label}" /
  // "Expand {label}") and the resize handle's ("Resize {label}"), e.g.
  // "artist images panel" or "collection details panel".
  label: string
  // localStorage key remembering the width the user dragged the panel to.
  widthStorageKey: string
  // Smallest width in px.
  minWidth?: number
  // Largest width as a fraction of the flex row the panel sits in.
  maxRatio?: number
  // Width in px when the user hasn't chosen one.
  defaultWidth?: number
  children: React.ReactNode
}

const DEFAULT_MIN_WIDTH = 280
const DEFAULT_MAX_RATIO = 0.5
const DEFAULT_WIDTH = 500
const KEY_STEP = 16
const KEY_STEP_SHIFT = 64

// The right-side notch-toggle panel shared by list pages (Artists,
// Collections): a small handle that slides a bordered panel in or out of the
// gap next to the main content. Open state isn't owned here — the caller's
// outer layout usually needs the same boolean to animate its own gap between
// the main column and this panel, so it stays lifted (typically via
// usePersistedOpen).
//
// From md up the open panel is resizable by dragging (or focusing and
// keyboarding) its left edge. The remembered width is a pixel value the user
// chose; it is clamped to [minWidth, maxRatio of the row] only when rendering and is
// never overwritten by that clamp, so a window shrink and regrow restores it.
// The 50% resolves against the flex row, which an element nested inside the
// width-animating wrapper can't do, so the row is measured with a
// ResizeObserver and the clamp is computed in pixels. The result is exposed as
// the --panel-w CSS variable on the outer item; below md the classes ignore it
// and keep the fixed w-80, with no handle.
export function CollapsiblePanel({
  open,
  onOpenChange,
  label,
  widthStorageKey,
  minWidth = DEFAULT_MIN_WIDTH,
  maxRatio = DEFAULT_MAX_RATIO,
  defaultWidth = DEFAULT_WIDTH,
  children,
}: CollapsiblePanelProps) {
  const [stored, setStored] = usePersistedWidth(widthStorageKey, defaultWidth)
  const [rowWidth, setRowWidth] = useState<number | null>(null)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const outerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragCleanup = useRef<(() => void) | null>(null)
  // Where the pointer grabbed the handle, relative to the panel's left edge,
  // so the width doesn't jump by that offset on press; `moved` keeps a plain
  // click from committing a (possibly clamped) width.
  const grab = useRef({ offset: 0, moved: false })

  useLayoutEffect(() => {
    const row = outerRef.current?.parentElement
    if (!row) return
    const measure = () => setRowWidth(row.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    return () => ro.disconnect()
  }, [])

  // Restore body styles if unmounted mid-drag.
  useLayoutEffect(() => () => dragCleanup.current?.(), [])

  const min = minWidth
  // If the row share is below the minimum, the minimum wins.
  const max = rowWidth === null ? Infinity : Math.max(min, Math.floor(rowWidth * maxRatio))
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)))
  const width = clamp(dragWidth ?? stored)
  const dragging = dragWidth !== null

  const commit = (w: number) => setStored(clamp(w))
  // Forget the remembered width so the panel follows defaultWidth again.
  const reset = () => setStored(null)

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    const right = rect.right
    grab.current = { offset: e.clientX - rect.left, moved: false }
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture?.(e.pointerId)
    const prevSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"
    dragCleanup.current = () => {
      document.body.style.userSelect = prevSelect
      document.body.style.cursor = prevCursor
      dragCleanup.current = null
    }
    setDragWidth(clamp(right - e.clientX + grab.current.offset))
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const right = panelRef.current?.getBoundingClientRect().right
    if (right === undefined) return
    grab.current.moved = true
    setDragWidth(clamp(right - e.clientX + grab.current.offset))
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>, apply: boolean) {
    if (dragWidth === null) return
    if (apply && grab.current.moved) commit(dragWidth)
    setDragWidth(null)
    dragCleanup.current?.()
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? KEY_STEP_SHIFT : KEY_STEP
    let next: number
    switch (e.key) {
      case "ArrowLeft":
        next = width + step
        break
      case "ArrowRight":
        next = width - step
        break
      case "Home":
        next = min
        break
      case "End":
        next = max === Infinity ? width : max
        break
      case "Enter":
        e.preventDefault()
        reset()
        return
      default:
        return
    }
    e.preventDefault()
    commit(next)
  }

  return (
    <div
      ref={outerRef}
      className="relative min-h-0 shrink-0"
      style={{ "--panel-w": `${width}px` } as React.CSSProperties}
    >
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
        ref={panelRef}
        className={cn(
          "relative h-full min-h-0 overflow-hidden ease-in-out",
          dragging ? "transition-none" : "transition-[width] duration-300",
          open ? "w-80 md:w-(--panel-w)" : "w-0",
        )}
      >
        {/* No right padding — main's own page-level p-4/md:p-6 already
            provides that margin out to the viewport edge, so adding the
            panel's own would double it up. Always the open width (even while
            the wrapper slides to w-0) so the content doesn't reflow. */}
        <div className="h-full w-80 min-h-0 overflow-y-auto border-l py-4 pl-4 md:w-(--panel-w) md:py-6 md:pl-6">
          {children}
        </div>

        {open && (
          // Hit area sits inside the panel's left edge (not straddling it) so
          // it never overlaps the notch toggle, which lives outside.
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${label}`}
            aria-valuenow={width}
            aria-valuemin={min}
            aria-valuemax={max === Infinity ? undefined : max}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(e, true)}
            onPointerCancel={(e) => endDrag(e, false)}
            onDoubleClick={reset}
            onKeyDown={onKeyDown}
            className={cn(
              "group absolute inset-y-0 left-0 z-10 hidden w-2 cursor-col-resize touch-none select-none outline-none md:block",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 w-0.5 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary/60",
                dragging && "bg-primary",
              )}
            />
          </div>
        )}
      </div>
    </div>
  )
}
