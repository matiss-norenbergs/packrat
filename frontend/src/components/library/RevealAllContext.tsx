import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { useLocation } from "react-router-dom"

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
//
// With `clearOnNavigate` (the shared AppLayout provider) the individually
// revealed items are also dropped whenever the route pathname changes, so
// they behave as if each page had its own provider; reveal-all itself is kept.
// Per-page providers (Browse, compare player) omit it and are unchanged.
export function RevealAllProvider({ children, clearOnNavigate = false }: { children: ReactNode; clearOnNavigate?: boolean }) {
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
      {clearOnNavigate && <ClearOnPathChange onChange={() => setRevealedIds((prev) => (prev.size ? new Set() : prev))} />}
      {children}
    </RevealAllContext.Provider>
  )
}

export function useRevealAll() {
  return useContext(RevealAllContext)
}

// Layout effect so the re-blur lands before the new page paints (no flash of
// still-revealed items). Only the pathname matters: query-string changes
// (search, filters, sort) and the Library view mode keep the reveals.
function ClearOnPathChange({ onChange }: { onChange: () => void }) {
  const { pathname } = useLocation()
  const previous = useRef(pathname)
  useLayoutEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    onChange()
  })
  return null
}
