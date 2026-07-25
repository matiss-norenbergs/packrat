import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface ItemMetrics {
  stride: number // item width + the flex gap between items
  itemWidth: number
  gap: number
}

// Item width and the flex gap between items, measured from actual rendered
// layout rather than assumed from a className — the caller's gap-* class is
// the only source of truth for this, and reading it back via
// getBoundingClientRect works regardless of what that value is. Falls back
// to the track's own width if there's only one child (nothing to measure a
// gap between).
function getItemMetrics(el: HTMLDivElement): ItemMetrics {
  const first = el.children[0] as HTMLElement | undefined
  if (!first) return { stride: el.clientWidth, itemWidth: el.clientWidth, gap: 0 }
  const itemWidth = first.getBoundingClientRect().width || el.clientWidth
  const second = el.children[1] as HTMLElement | undefined
  let stride = itemWidth
  if (second) {
    const measured = second.getBoundingClientRect().left - first.getBoundingClientRect().left
    if (measured > 0) stride = measured
  }
  return { stride, itemWidth, gap: Math.max(0, stride - itemWidth) }
}

// The real, reachable scroll-left positions for this track — one per
// "page." The track carries no padding (padding was tried both as a
// constant and as a per-side toggle, but toggling it shifted content
// mid-scroll since padding is part of what scrollLeft is measured against,
// causing a visible "shake"; staying constant left a gutter that
// misaligned the row from the rest of the page). Instead, every page after
// the first is deliberately scrolled *short* of a clean item boundary, so
// the edge items on a middle page show as an intentional half-item peek
// (matching what the fade/arrow already hint at) while the items between
// them are always fully intact — no gradient needs to be reserved over
// "clean" content this way. The first page has no such offset (nothing
// precedes item 0 to peek at), so it naturally fits one more full item
// than a middle page does. The last page is still clamped to maxScroll, so
// it just shows whatever's left.
function getStops(el: HTMLDivElement): number[] {
  const maxScroll = el.scrollWidth - el.clientWidth
  if (maxScroll <= 0) return [0]
  const { stride, itemWidth, gap } = getItemMetrics(el)
  if (stride <= 0) return [0, maxScroll]
  // A run of N clean items only has N-1 internal gaps (no trailing gap
  // after the last one), so a peek window sized as leftover-space/2 lands
  // short by half a gap on the right and long by half a gap on the left.
  // Adding the gap back before splitting corrects that and keeps the two
  // peeks equal. The target itself is half an item's width — genuinely
  // "half the previous/next item visible," not half a stride (which would
  // bake the gap into the visible fraction and overshoot past half).
  const idealPeek = itemWidth / 2 + gap
  const peekFor = (n: number) => (el.clientWidth - n * stride + gap) / 2
  // itemsPerPage candidates: whichever of "floor" or "floor + 1" lands the
  // peek closest to that ideal — flooring alone can leave up to a whole
  // stride of leftover, which reads as "most of an item" peeking rather
  // than "half," so the nearer of the two neighboring counts is used
  // instead, whichever way the track width happens to divide.
  const low = Math.max(1, Math.floor((el.clientWidth - stride) / stride))
  const high = low + 1
  const peekLow = peekFor(low)
  const peekHigh = peekFor(high)
  const itemsPerPage =
    peekHigh >= 0 && Math.abs(peekHigh - idealPeek) < Math.abs(peekLow - idealPeek) ? high : low
  const peek = peekFor(itemsPerPage)
  const pageAdvance = itemsPerPage * stride
  const count = Math.max(1, Math.ceil(maxScroll / pageAdvance) + 1)
  return Array.from({ length: count }, (_, i) => {
    const target = i === 0 ? 0 : i * pageAdvance - peek
    return Math.max(0, Math.min(Math.round(target), maxScroll))
  })
}

function nearestStopIndex(scrollLeft: number, stops: number[]): number {
  let nearest = 0
  let nearestDist = Infinity
  for (let i = 0; i < stops.length; i++) {
    const dist = Math.abs(stops[i] - scrollLeft)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = i
    }
  }
  return nearest
}

interface ScrollState {
  canScroll: boolean
  canScrollLeft: boolean
  canScrollRight: boolean
  segmentCount: number
  currentSegment: number
}

function readScrollState(el: HTMLDivElement): ScrollState {
  const canScroll = el.scrollWidth > el.clientWidth + 1
  const maxScroll = el.scrollWidth - el.clientWidth
  const stops = getStops(el)
  return {
    canScroll,
    canScrollLeft: canScroll && el.scrollLeft > 1,
    canScrollRight: canScroll && el.scrollLeft < maxScroll - 1,
    segmentCount: stops.length,
    currentSegment: nearestStopIndex(el.scrollLeft, stops),
  }
}

// Netflix-style horizontal row: no visible scrollbar, faded edges, a
// hover-revealed arrow on each side that pages by a whole number of items
// at a time, and a bottom row of segment cells showing how many pages
// there are and which one is in view. Each side's fade only shows up once
// there's actually more content in that direction — at the true start or
// end there's nothing to hint at, so that side sits flush with no gutter.
// The track has no reserved padding for the fade, so where a fade *is*
// shown it sits directly over the edge item rather than over blank space
// (see getStops for why — reserving space there caused a visible shake).
// The arrows themselves stay available on both sides whenever the row is
// scrollable at all, though: clicking past the last (or first) segment
// loops around rather than doing nothing, so there's always "more"
// reachable even from an edge where the fade isn't shown.
export function HorizontalScroller({ children, className }: { children: ReactNode; className?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [segmentCount, setSegmentCount] = useState(1)
  const [currentSegment, setCurrentSegment] = useState(0)

  const applyState = (state: ScrollState) => {
    setCanScroll(state.canScroll)
    setCanScrollLeft(state.canScrollLeft)
    setCanScrollRight(state.canScrollRight)
    setSegmentCount(state.segmentCount)
    setCurrentSegment(state.currentSegment)
  }

  // Recomputed after every render (children/layout may have changed the
  // track's scrollWidth without the container's own box size changing, so a
  // plain ResizeObserver on the track alone isn't enough) and again on
  // window resize.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => applyState(readScrollState(el))
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  })

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => applyState(readScrollState(el)))
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  const scrollToSegment = (index: number) => {
    const el = scrollRef.current
    if (!el) return
    const stops = getStops(el)
    el.scrollTo({ left: stops[Math.max(0, Math.min(index, stops.length - 1))], behavior: "smooth" })
  }

  const handleArrow = (dir: "left" | "right") => {
    const el = scrollRef.current
    if (!el) return
    const stops = getStops(el)
    const maxScroll = el.scrollWidth - el.clientWidth
    const current = nearestStopIndex(el.scrollLeft, stops)
    if (dir === "right") {
      if (el.scrollLeft >= maxScroll - 1) el.scrollTo({ left: 0, behavior: "smooth" })
      else el.scrollTo({ left: stops[Math.min(current + 1, stops.length - 1)], behavior: "smooth" })
    } else {
      if (el.scrollLeft <= 1) el.scrollTo({ left: maxScroll, behavior: "smooth" })
      else el.scrollTo({ left: stops[Math.max(current - 1, 0)], behavior: "smooth" })
    }
  }

  return (
    <div className="group/scroller">
      <div className="relative">
        {canScrollLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent md:w-10" />
        )}
        {canScrollRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent md:w-10" />
        )}
        {canScroll && (
          <>
            <button
              type="button"
              aria-label="Scroll left"
              onClick={() => handleArrow("left")}
              className="absolute inset-y-0 left-0 z-20 flex w-6 items-center justify-center opacity-100 transition-opacity md:w-10 md:opacity-0 md:group-hover/scroller:opacity-100"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur-sm hover:bg-background/95">
                <ChevronLeft className="h-5 w-5" />
              </span>
            </button>
            <button
              type="button"
              aria-label="Scroll right"
              onClick={() => handleArrow("right")}
              className="absolute inset-y-0 right-0 z-20 flex w-6 items-center justify-center opacity-100 transition-opacity md:w-10 md:opacity-0 md:group-hover/scroller:opacity-100"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur-sm hover:bg-background/95">
                <ChevronRight className="h-5 w-5" />
              </span>
            </button>
          </>
        )}
        <div ref={scrollRef} className={cn("scrollbar-none flex overflow-x-auto scroll-smooth", className)}>
          {children}
        </div>
      </div>

      {canScroll && segmentCount > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {Array.from({ length: segmentCount }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to section ${i + 1} of ${segmentCount}`}
              onClick={() => scrollToSegment(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === currentSegment ? "w-6 bg-foreground" : "w-3 bg-muted-foreground/30 hover:bg-muted-foreground/50",
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
