import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react"
import type { LibraryItem } from "@/types/api"

interface SelectionActions {
  toggleItem: (item: LibraryItem) => void
  toggleCollection: (id: number, totalItemCount: number) => void
  // Bulk variants for a "select all" header checkbox — add/remove every
  // given item in one state update rather than toggling one at a time.
  selectItems: (items: LibraryItem[]) => void
  deselectItems: (ids: number[]) => void
  clear: () => void
}

interface SelectionContextValue extends SelectionActions {
  selectedItems: Map<number, LibraryItem>
  selectedCollectionIds: Set<number>
  selectionActive: boolean
  // Individually-selected files plus the recursive totalItemCount of every
  // selected collection — a cheap live estimate for the toolbar. It can
  // double-count an item that's both individually selected and covered by a
  // selected collection; the real, deduped list is resolved lazily by
  // BulkAssignTagsDialog when it opens.
  approxCount: number
  isItemSelected: (id: number) => boolean
  isCollectionSelected: (id: number) => boolean
}

interface SelectionState {
  items: Map<number, LibraryItem>
  collections: Set<number>
  collectionCounts: Map<number, number>
}

// The selection lives in an external store (not React state) so that a card can subscribe to just
// "is MY item selected" and a tick re-renders that card only. The store object and its actions never
// change identity; `getValue()` returns a snapshot that changes only when the selection does.
interface SelectionStore {
  subscribe: (listener: () => void) => () => void
  getValue: () => SelectionContextValue
  actions: SelectionActions
}

function createSelectionStore(readOnly = false): SelectionStore {
  let state: SelectionState = { items: new Map(), collections: new Set(), collectionCounts: new Map() }
  const listeners = new Set<() => void>()

  const buildValue = (): SelectionContextValue => {
    let approxCount = state.items.size
    for (const id of state.collections) approxCount += state.collectionCounts.get(id) ?? 0
    const { items, collections } = state
    return {
      selectedItems: items,
      selectedCollectionIds: collections,
      selectionActive: items.size > 0 || collections.size > 0,
      approxCount,
      isItemSelected: (id) => items.has(id),
      isCollectionSelected: (id) => collections.has(id),
      ...actions,
    }
  }

  const set = (next: SelectionState) => {
    if (readOnly) return
    state = next
    value = buildValue()
    for (const l of [...listeners]) l()
  }

  const actions: SelectionActions = {
    toggleItem: (item) => {
      const items = new Map(state.items)
      if (items.has(item.id)) items.delete(item.id)
      else items.set(item.id, item)
      set({ ...state, items })
    },
    selectItems: (list) => {
      if (list.length === 0) return
      const items = new Map(state.items)
      for (const item of list) items.set(item.id, item)
      set({ ...state, items })
    },
    deselectItems: (ids) => {
      if (!ids.some((id) => state.items.has(id))) return
      const items = new Map(state.items)
      for (const id of ids) items.delete(id)
      set({ ...state, items })
    },
    toggleCollection: (id, totalItemCount) => {
      const collections = new Set(state.collections)
      if (collections.has(id)) collections.delete(id)
      else collections.add(id)
      const collectionCounts = new Map(state.collectionCounts)
      collectionCounts.set(id, totalItemCount)
      set({ ...state, collections, collectionCounts })
    },
    clear: () => {
      if (state.items.size === 0 && state.collections.size === 0 && state.collectionCounts.size === 0) return
      set({ items: new Map(), collections: new Set(), collectionCounts: new Map() })
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
  }
}

// No provider (Browse, tests): an empty selection that ignores every write, like the old default context value.
const EMPTY_STORE = createSelectionStore(true)

const SelectionContext = createContext<SelectionStore>(EMPTY_STORE)

// Session-only (not persisted) multi-select state for the Library page's
// manage mode — mirrors RevealAllContext.tsx's shape. Selection deliberately
// persists across search/sort/pagination/folder navigation within the page
// (so a user can hand-pick files across several folders, then also
// whole-select another folder) and only resets via clear(), a successful
// bulk save, or leaving the Library page (this provider unmounting).
//
// The context value is the (never changing) store, so the provider never re-renders its consumers. They
// subscribe through the hooks below: useSelection() to everything, the narrow ones to one slice.
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createSelectionStore())
  return <SelectionContext.Provider value={store}>{children}</SelectionContext.Provider>
}

/** The whole selection. Re-renders on every change; per-item consumers should use the narrow hooks. */
export function useSelection(): SelectionContextValue {
  const store = useContext(SelectionContext)
  return useSyncExternalStore(store.subscribe, store.getValue)
}

/** Whether this one item is selected; re-renders only when that flips. */
export function useIsItemSelected(id: number): boolean {
  const store = useContext(SelectionContext)
  return useSyncExternalStore(store.subscribe, () => store.getValue().selectedItems.has(id))
}

/** Whether this one collection is selected; re-renders only when that flips. */
export function useIsCollectionSelected(id: number): boolean {
  const store = useContext(SelectionContext)
  return useSyncExternalStore(store.subscribe, () => store.getValue().selectedCollectionIds.has(id))
}

/** True while anything is selected; flips only when the selection goes empty <-> non-empty. */
export function useSelectionActive(): boolean {
  const store = useContext(SelectionContext)
  return useSyncExternalStore(store.subscribe, () => store.getValue().selectionActive)
}

/** The mutators, with a permanently stable identity (never re-renders). */
export function useSelectionActions(): SelectionActions {
  return useContext(SelectionContext).actions
}
