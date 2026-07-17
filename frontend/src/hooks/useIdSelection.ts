import { useState } from "react"

export function useIdSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggle = (id: number) => {
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

  const clear = () => setSelected(new Set())
  const isSelected = (id: number) => selected.has(id)

  return { selected, isSelected, toggle, clear, size: selected.size, active: selected.size > 0 }
}
