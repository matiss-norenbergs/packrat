import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { useMatches } from "react-router-dom"

interface RevealActions {
  toggleItem: (id: number) => void
  hideItem: (id: number) => void
  revealItems: (ids: number[]) => void
  toggleRevealAll: () => void
  hideAll: () => void
}

interface RevealAllContextValue extends RevealActions {
  revealAll: boolean
  isRevealed: (id: number) => boolean
}

interface RevealState {
  revealAll: boolean
  revealedIds: Set<number>
}

// Like the selection, the reveal state lives in an external store so a card subscribes to just "is MY
// item revealed" (useIsRevealed) and the provider never re-renders consumers when its parent does (the
// shared AppLayout provider's parent re-renders on every URL change). The store and its actions never
// change identity; `getValue()` changes only when the reveal state does.
interface RevealStore {
  subscribe: (listener: () => void) => () => void
  getValue: () => RevealAllContextValue
  actions: RevealActions
  // Drops the individually revealed items (reveal-all itself is kept).
  clearIndividual: () => void
}

function createRevealStore(readOnly = false): RevealStore {
  let state: RevealState = { revealAll: false, revealedIds: new Set() }
  const listeners = new Set<() => void>()

  const buildValue = (): RevealAllContextValue => {
    const { revealAll, revealedIds } = state
    return { revealAll, isRevealed: (id) => revealAll || revealedIds.has(id), ...actions }
  }
  const set = (next: RevealState) => {
    if (readOnly || next === state) return
    state = next
    value = buildValue()
    for (const l of [...listeners]) l()
  }
  const emptyIds = (ids: Set<number>) => (ids.size ? new Set<number>() : ids)

  const actions: RevealActions = {
    // Turning it on reveals everything regardless of what's individually been clicked; turning it back
    // off blurs everything again, clearing any items individually revealed rather than leaving them stuck open.
    toggleRevealAll: () => {
      const revealAll = !state.revealAll
      set({ revealAll, revealedIds: revealAll ? state.revealedIds : emptyIds(state.revealedIds) })
    },
    // Explicit OFF (unlike the toggle): used by the library item page, whose
    // visit ends reveal-all. Idempotent, so calling it twice is harmless.
    hideAll: () => {
      if (!state.revealAll && state.revealedIds.size === 0) return
      set({ revealAll: false, revealedIds: emptyIds(state.revealedIds) })
    },
    toggleItem: (id) => {
      const revealedIds = new Set(state.revealedIds)
      if (revealedIds.has(id)) revealedIds.delete(id)
      else revealedIds.add(id)
      set({ ...state, revealedIds })
    },
    // Drops one individually revealed key; leaves reveal-all and every other key
    // alone, and is a no-op when the key isn't revealed.
    hideItem: (id) => {
      if (!state.revealedIds.has(id)) return
      const revealedIds = new Set(state.revealedIds)
      revealedIds.delete(id)
      set({ ...state, revealedIds })
    },
    // Additive only — used to bring a whole collection along when its main
    // item is revealed, without disturbing anything a user already toggled
    // individually elsewhere.
    revealItems: (ids) => {
      if (ids.every((id) => state.revealedIds.has(id))) return
      set({ ...state, revealedIds: new Set([...state.revealedIds, ...ids]) })
    },
  }

  let value = buildValue()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getValue: () => value,
    actions,
    clearIndividual: () => {
      if (state.revealedIds.size > 0) set({ ...state, revealedIds: new Set() })
    },
  }
}

// No provider: nothing is revealed and every write is ignored, as before.
const EMPTY_STORE = createRevealStore(true)

const RevealAllContext = createContext<RevealStore>(EMPTY_STORE)

// Session-only (not persisted): centralizes every card's reveal state here
// instead of each LibraryCard owning its own — that's what lets the toolbar
// toggle be fully authoritative in both directions.
//
// With `clearOnNavigate` (the shared AppLayout provider) the individually
// revealed items are also dropped whenever the matched route changes, so
// they behave as if each page had its own provider; reveal-all itself is kept.
// "Route change" means a different matched route, not a different URL: moving
// between items of the same page (/library/1 -> /library/2, e.g. via the
// "More from this collection" strip) keeps the reveals. Needs a data router.
// Per-page providers (Browse, compare player) omit it and are unchanged.
export function RevealAllProvider({ children, clearOnNavigate = false }: { children: ReactNode; clearOnNavigate?: boolean }) {
  const [store] = useState(() => createRevealStore())
  return (
    <RevealAllContext.Provider value={store}>
      {clearOnNavigate && <ClearOnRouteChange onChange={store.clearIndividual} />}
      {children}
    </RevealAllContext.Provider>
  )
}

/** The whole reveal state. Re-renders on every change; per-item consumers should use the narrow hooks. */
export function useRevealAll(): RevealAllContextValue {
  const store = useContext(RevealAllContext)
  return useSyncExternalStore(store.subscribe, store.getValue)
}

/** Whether this one item is revealed (reveal-all counts); re-renders only when that flips. */
export function useIsRevealed(id: number): boolean {
  const store = useContext(RevealAllContext)
  return useSyncExternalStore(store.subscribe, () => store.getValue().isRevealed(id))
}

/** The mutators, with a permanently stable identity (never re-renders). */
export function useRevealActions(): RevealActions {
  return useContext(RevealAllContext).actions
}

// Layout effect so the re-blur lands before the new page paints (no flash of
// still-revealed items). Keyed on the id of the deepest matched route: params
// (/library/:id), the query string (search, filters, sort) and the Library
// view mode all leave it unchanged, so they keep the reveals.
function ClearOnRouteChange({ onChange }: { onChange: () => void }) {
  const matches = useMatches()
  const routeId = matches[matches.length - 1]?.id
  const previous = useRef(routeId)
  useLayoutEffect(() => {
    if (previous.current === routeId) return
    previous.current = routeId
    onChange()
  })
  return null
}
