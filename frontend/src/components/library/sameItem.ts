import { useState } from "react"
import type { LibraryItem } from "@/types/api"

/**
 * Whether two copies of a library item hold the same data. A refetch (or a switch to another query that includes the item)
 * hands over fresh objects for items that did not change; the fields are primitives except `tags`, so comparing them is far
 * cheaper than re-rendering the card or table row built from the item.
 */
export function sameItem(a: LibraryItem, b: LibraryItem): boolean {
  if (a === b) return true
  const keys = Object.keys(a) as (keyof LibraryItem)[]
  if (keys.length !== Object.keys(b).length) return false
  for (const k of keys) {
    if (a[k] === b[k]) continue
    if (k === "tags" && a.tags.length === b.tags.length && a.tags.every((t, i) => t === b.tags[i])) continue
    return false
  }
  return true
}

/**
 * `items` with every unchanged item replaced by the object of the previous render, so memoized rows (the list view's table)
 * skip it. The result changes only when `items` does.
 */
export function useStableItems(items: LibraryItem[]): LibraryItem[] {
  const [state, setState] = useState({ source: items, stable: items })
  if (state.source === items) return state.stable
  const before = new Map(state.stable.map((item) => [item.id, item]))
  const stable = items.map((item) => {
    const old = before.get(item.id)
    return old && sameItem(old, item) ? old : item
  })
  // State adjusted during render (React re-renders at once with it), so the result is never a pass behind.
  setState({ source: items, stable })
  return stable
}
