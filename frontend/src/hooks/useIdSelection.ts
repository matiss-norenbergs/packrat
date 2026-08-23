import { useState } from "react"

// Generic over the id type — defaults to number (every existing caller's
// row ids), but a caller keyed by a string id (e.g. a subscription entry's
// sourceId) can pass that in explicitly: useIdSelection<string>().
export function useIdSelection<T = number>() {
  const [selected, setSelected] = useState<Set<T>>(new Set())

  const toggle = (id: T) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const clear = () => setSelected(new Set<T>())
  const isSelected = (id: T) => selected.has(id)
  const selectAll = (ids: T[]) => setSelected(new Set(ids))
  const selectOnly = (id: T) => setSelected(new Set([id]))

  return {
    selected,
    isSelected,
    toggle,
    clear,
    selectAll,
    selectOnly,
    size: selected.size,
    active: selected.size > 0,
  }
}
