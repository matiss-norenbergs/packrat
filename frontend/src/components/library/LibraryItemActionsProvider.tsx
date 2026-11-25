import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useEvent } from "@/components/data-table/useEvent"
import type { LibraryItem } from "@/types/api"
import { useLibraryItemActions, type LibraryItemAction } from "./libraryItemActions"

interface SharedItemActions {
  actionsFor: (item: LibraryItem) => LibraryItemAction[]
}

const SharedItemActionsContext = createContext<SharedItemActions | null>(null)

/** The shared actions host of the surrounding grid / folder view, or null (the item page keeps its own host). */
export function useSharedItemActions(): SharedItemActions | null {
  return useContext(SharedItemActionsContext)
}

const NO_ITEMS: readonly LibraryItem[] = []

/**
 * One actions host (every dialog and mutation hook of `useLibraryItemActions`) for all the cards of a grid or folder
 * view, the way the list view mounts one for its table, instead of one per card (~100 hook calls and ~25 closed
 * subtrees each). `items` are the items currently rendered: an open dialog resolves its item from them on every
 * render, so it follows a refetch, and it keeps the last snapshot when the item leaves the page.
 *
 * The context value (`actionsFor`) never changes identity, and `children` is passed through untouched, so a dialog
 * opening or closing re-renders this component and the host only, never the cards.
 */
export function LibraryItemActionsProvider({ items, children }: { items: readonly LibraryItem[] | undefined; children: ReactNode }) {
  const { actionsFor, host } = useLibraryItemActions(undefined, items ?? NO_ITEMS)
  const stableActionsFor = useEvent(actionsFor)
  const value = useMemo(() => ({ actionsFor: stableActionsFor }), [stableActionsFor])
  return (
    <SharedItemActionsContext.Provider value={value}>
      {children}
      {host}
    </SharedItemActionsContext.Provider>
  )
}
