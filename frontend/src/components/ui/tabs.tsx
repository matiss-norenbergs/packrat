import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useHorizontalOverflow } from "@/hooks/useHorizontalOverflow"
import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-4", className)} {...props} />
}

// Room kept clear of the floating buttons when a tab is scrolled into view.
const EDGE_INSET = 56

// Approximate line height used to turn line-mode wheel deltas (e.g. Firefox with a notched mouse) into pixels.
const WHEEL_LINE_PX = 16

function wheelDeltaPx(e: WheelEvent, pageSize: number): number {
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return e.deltaY * WHEEL_LINE_PX
  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return e.deltaY * pageSize
  return e.deltaY
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
}

// Scroll just far enough to bring `tab` fully into view, clear of the edge buttons.
function revealTab(list: HTMLElement, tab: HTMLElement, behavior: ScrollBehavior) {
  const listRect = list.getBoundingClientRect()
  const tabRect = tab.getBoundingClientRect()
  const overLeft = listRect.left + EDGE_INSET - tabRect.left
  const overRight = tabRect.right - (listRect.right - EDGE_INSET)
  if (overLeft > 0) list.scrollTo({ left: list.scrollLeft - overLeft, behavior })
  else if (overRight > 0) list.scrollTo({ left: list.scrollLeft + overRight, behavior })
}

function TabsList({ className, ...props }: Omit<React.ComponentProps<typeof TabsPrimitive.List>, "ref">) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const { canScrollLeft, canScrollRight } = useHorizontalOverflow(listRef)

  React.useEffect(() => {
    const list = listRef.current
    if (!list) return
    const activeTab = () => list.querySelector<HTMLElement>('[role="tab"][data-state="active"]')

    const initial = activeTab()
    if (initial) revealTab(list, initial, "auto")

    // Web fonts changing tab widths after first paint would leave the active tab half under a button.
    let cancelled = false
    void document.fonts?.ready.then(() => {
      const tab = activeTab()
      if (!cancelled && tab) revealTab(list, tab, "auto")
    })

    // The active tab changes via data-state flipping on the triggers.
    const observer = new MutationObserver((records) => {
      if (records.some((r) => (r.target as HTMLElement).getAttribute("data-state") === "active")) {
        const tab = activeTab()
        if (tab) revealTab(list, tab, scrollBehavior())
      }
    })
    observer.observe(list, { subtree: true, attributes: true, attributeFilter: ["data-state"] })

    const onFocusIn = (e: FocusEvent) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]')
      if (tab) revealTab(list, tab, scrollBehavior())
    }
    list.addEventListener("focusin", onFocusIn)

    // A plain vertical wheel scrolls the row sideways, but only while it can still move that way,
    // so the page takes over at either end. Needs a non-passive listener to preventDefault.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0 || e.deltaY === 0 || e.ctrlKey) return
      const max = list.scrollWidth - list.clientWidth
      if (max <= 1) return
      const atStart = list.scrollLeft <= 0 && e.deltaY < 0
      const atEnd = list.scrollLeft >= max - 1 && e.deltaY > 0
      if (atStart || atEnd) return
      e.preventDefault()
      list.scrollLeft += wheelDeltaPx(e, list.clientWidth)
    }
    list.addEventListener("wheel", onWheel, { passive: false })

    return () => {
      cancelled = true
      observer.disconnect()
      list.removeEventListener("focusin", onFocusIn)
      list.removeEventListener("wheel", onWheel)
    }
  }, [])

  const scrollByPage = (dir: -1 | 1) => {
    const list = listRef.current
    if (!list) return
    list.scrollBy({ left: dir * list.clientWidth * 0.7, behavior: scrollBehavior() })
  }

  return (
    <div className="relative shrink-0">
      {/* The overlays stop 1px short of the bottom so the list's own border line stays continuous. */}
      {canScrollLeft && (
        <div className="pointer-events-none absolute top-0 bottom-px left-0 z-10 flex w-16 items-center bg-gradient-to-r from-card from-50% to-transparent pl-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            aria-hidden
            className="pointer-events-auto rounded-full text-muted-foreground"
            onClick={() => scrollByPage(-1)}
          >
            <ChevronLeft />
          </Button>
        </div>
      )}
      {canScrollRight && (
        <div className="pointer-events-none absolute top-0 right-0 bottom-px z-10 flex w-16 items-center justify-end bg-gradient-to-l from-card from-50% to-transparent pr-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            aria-hidden
            className="pointer-events-auto rounded-full text-muted-foreground"
            onClick={() => scrollByPage(1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
      <TabsPrimitive.List
        ref={listRef}
        data-slot="tabs-list"
        className={cn("scrollbar-none flex items-center gap-1 overflow-x-auto border-b", className)}
        {...props}
      />
    </div>
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "shrink-0 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("focus-visible:outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
