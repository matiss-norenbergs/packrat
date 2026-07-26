import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import type { LibraryItem } from "@/types/api"

interface SelectionContextValue {
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
  toggleItem: (item: LibraryItem) => void
  toggleCollection: (id: number, totalItemCount: number) => void
  // Bulk variants for a "select all" header checkbox — add/remove every
  // given item in one state update rather than toggling one at a time.
  selectItems: (items: LibraryItem[]) => void
  deselectItems: (ids: number[]) => void
  clear: () => void
}

const SelectionContext = createContext<SelectionContextValue>({
  selectedItems: new Map(),
  selectedCollectionIds: new Set(),
  selectionActive: false,
  approxCount: 0,
  isItemSelected: () => false,
  isCollectionSelected: () => false,
  toggleItem: () => {},
  toggleCollection: () => {},
  selectItems: () => {},
  deselectItems: () => {},
  clear: () => {},
})

// Session-only (not persisted) multi-select state for the Library page's
// manage mode — mirrors RevealAllContext.tsx's shape. Selection deliberately
// persists across search/sort/pagination/folder navigation within the page
// (so a user can hand-pick files across several folders, then also
// whole-select another folder) and only resets via clear(), a successful
// bulk save, or leaving the Library page (this provider unmounting).
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedItems, setSelectedItems] = useState<Map<number, LibraryItem>>(new Map())
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<number>>(new Set())
  const [collectionCounts, setCollectionCounts] = useState<Map<number, number>>(new Map())

  const toggleItem = (item: LibraryItem) => {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.set(item.id, item)
      return next
    })
  }

  const selectItems = (items: LibraryItem[]) => {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      for (const item of items) next.set(item.id, item)
      return next
    })
  }

  const deselectItems = (ids: number[]) => {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      for (const id of ids) next.delete(id)
      return next
    })
  }

  const toggleCollection = (id: number, totalItemCount: number) => {
    setSelectedCollectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setCollectionCounts((prev) => {
      const next = new Map(prev)
      next.set(id, totalItemCount)
      return next
    })
  }

  const clear = () => {
    setSelectedItems(new Map())
    setSelectedCollectionIds(new Set())
    setCollectionCounts(new Map())
  }

  const isItemSelected = (id: number) => selectedItems.has(id)
  const isCollectionSelected = (id: number) => selectedCollectionIds.has(id)

  const approxCount = useMemo(() => {
    let count = selectedItems.size
    for (const id of selectedCollectionIds) count += collectionCounts.get(id) ?? 0
    return count
  }, [selectedItems, selectedCollectionIds, collectionCounts])

  const selectionActive = selectedItems.size > 0 || selectedCollectionIds.size > 0

  return (
    <SelectionContext.Provider
      value={{
        selectedItems,
        selectedCollectionIds,
        selectionActive,
        approxCount,
        isItemSelected,
        isCollectionSelected,
        toggleItem,
        toggleCollection,
        selectItems,
        deselectItems,
        clear,
      }}
    >
      {children}
    </SelectionContext.Provider>
  )
}

export function useSelection() {
  return useContext(SelectionContext)
}
