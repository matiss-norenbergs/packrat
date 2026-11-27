import { useMemo, useSyncExternalStore } from "react"
import { columnsAtWidth } from "./columns"
import type { ColumnPreset } from "./columns"

// Tailwind 4 writes its breakpoints in rem (`sm` = 40rem, `lg` = 64rem), and a media query in rem is relative to the
// browser's default font size. The same unit here keeps the count equal to the CSS grid's, even for a user whose default
// font size is not 16px.
const query = (minWidth: number) => `(min-width: ${minWidth / 16}rem)`

/**
 * How many columns the preset's CSS grid shows right now, from `matchMedia` on each breakpoint (not `innerWidth`, which
 * counts the scrollbar and so differs from what a media query sees), re-read whenever one of them flips.
 */
export function useColumnCount(preset: ColumnPreset): number {
  const lists = useMemo(
    () =>
      typeof window.matchMedia === "function"
        ? preset.breakpoints.map((step) => ({ step, mql: step.minWidth > 0 ? window.matchMedia(query(step.minWidth)) : null }))
        : null,
    [preset],
  )
  const store = useMemo(
    () => ({
      subscribe(onChange: () => void) {
        if (!lists) {
          window.addEventListener("resize", onChange)
          return () => window.removeEventListener("resize", onChange)
        }
        const mqls = lists.flatMap((l) => (l.mql ? [l.mql] : []))
        for (const m of mqls) m.addEventListener("change", onChange)
        return () => {
          for (const m of mqls) m.removeEventListener("change", onChange)
        }
      },
      getSnapshot() {
        if (!lists) return columnsAtWidth(preset, window.innerWidth)
        let columns = preset.breakpoints[0].columns
        for (const { step, mql } of lists) if (!mql || mql.matches) columns = step.columns
        return columns
      },
    }),
    [lists, preset],
  )
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => preset.breakpoints[0].columns)
}
