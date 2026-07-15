import { createContext, useContext, useState, type ReactNode } from "react"

interface RevealAllContextValue {
  revealAll: boolean
  isRevealed: (id: number) => boolean
  toggleItem: (id: number) => void
  revealItems: (ids: number[]) => void
  toggleRevealAll: () => void
}

const RevealAllContext = createContext<RevealAllContextValue>({
  revealAll: false,
  isRevealed: () => false,
  toggleItem: () => {},
  revealItems: () => {},
  toggleRevealAll: () => {},
})

// Session-only (not persisted): centralizes every card's reveal state here
// instead of each LibraryCard owning its own — that's what lets the toolbar
// toggle be fully authoritative in both directions. Turning it on reveals
// everything regardless of what's individually been clicked; turning it back
// off blurs everything again, clearing any items a user had individually
// revealed rather than leaving them stuck open.
export function RevealAllProvider({ children }: { children: ReactNode }) {
  const [revealAll, setRevealAll] = useState(false)
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set())

  const toggleRevealAll = () => {
    setRevealAll((prev) => {
      const next = !prev
      if (!next) setRevealedIds(new Set())
      return next
    })
  }

  const toggleItem = (id: number) => {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Additive only — used to bring a whole collection along when its main
  // item is revealed, without disturbing anything a user already toggled
  // individually elsewhere.
  const revealItems = (ids: number[]) => {
    setRevealedIds((prev) => new Set([...prev, ...ids]))
  }

  const isRevealed = (id: number) => revealAll || revealedIds.has(id)

  return (
    <RevealAllContext.Provider value={{ revealAll, isRevealed, toggleItem, revealItems, toggleRevealAll }}>
      {children}
    </RevealAllContext.Provider>
  )
}

export function useRevealAll() {
  return useContext(RevealAllContext)
}
