import { useLayoutEffect, useRef } from "react"

// Scrolls a container back to the top when any value of `key` changes between renders. Compared on every render in a
// layout effect (before paint, no extra render); not on mount, and never for anything outside the key (a refetch, a
// selection change, a resize). Only scrollTop is touched, so scrollLeft stays. `getContainer` is read at that moment.
export function useScrollTopOnChange(getContainer: () => HTMLElement | null | undefined, key: readonly unknown[]) {
  const previous = useRef<readonly unknown[] | null>(null)
  useLayoutEffect(() => {
    const prev = previous.current
    previous.current = key
    if (!prev || key.every((v, i) => Object.is(v, prev[i]))) return
    const container = getContainer()
    if (container) container.scrollTop = 0
  })
}
