import { useLayoutEffect, useState, type RefObject } from "react"

export interface HorizontalOverflow {
  canScroll: boolean
  canScrollLeft: boolean
  canScrollRight: boolean
}

// Whether a horizontally scrollable element has more content to reveal, and in which direction.
// The 1px slack absorbs sub-pixel rounding in scrollWidth/scrollLeft.
export function readOverflow(el: HTMLElement): HorizontalOverflow {
  const canScroll = el.scrollWidth > el.clientWidth + 1
  const maxScroll = el.scrollWidth - el.clientWidth
  return {
    canScroll,
    canScrollLeft: canScroll && el.scrollLeft > 1,
    canScrollRight: canScroll && el.scrollLeft < maxScroll - 1,
  }
}

const NO_OVERFLOW: HorizontalOverflow = { canScroll: false, canScrollLeft: false, canScrollRight: false }

// Tracks an element's overflow state: on scroll (rAF-throttled, passive) and on size changes of the
// element or its children (ResizeObserver, which also covers tabs appearing and window resizes).
export function useHorizontalOverflow(ref: RefObject<HTMLElement | null>): HorizontalOverflow {
  const [state, setState] = useState(NO_OVERFLOW)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = () => {
      const next = readOverflow(el)
      setState((prev) =>
        prev.canScroll === next.canScroll &&
        prev.canScrollLeft === next.canScrollLeft &&
        prev.canScrollRight === next.canScrollRight
          ? prev
          : next,
      )
    }
    apply()

    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(apply)
    }
    el.addEventListener("scroll", onScroll, { passive: true })

    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(apply)
      observer.observe(el)
      for (const child of Array.from(el.children)) observer.observe(child)
    }

    // Children added or removed later (e.g. the Desktop tab) need observing too.
    const mutations = new MutationObserver(() => {
      if (observer) {
        observer.disconnect()
        observer.observe(el)
        for (const child of Array.from(el.children)) observer.observe(child)
      }
      apply()
    })
    mutations.observe(el, { childList: true })

    return () => {
      el.removeEventListener("scroll", onScroll)
      cancelAnimationFrame(raf)
      observer?.disconnect()
      mutations.disconnect()
    }
  }, [ref])

  return state
}
