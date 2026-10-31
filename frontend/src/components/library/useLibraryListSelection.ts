import { useCallback, useMemo } from "react"
import { useEvent } from "@/components/data-table/useEvent"
import type { IdSelection } from "@/hooks/useIdSelection"
import type { LibraryItem } from "@/types/api"
import { useSelection } from "./SelectionContext"

/**
 * The Library's persisting selection (SelectionContext) as the `IdSelection<number>` a DataTable takes as
 * `selectionState`, so the list view gets the table's gestures (click, ctrl/cmd, shift, drag, checkboxes) while the
 * grid and folder views keep using the context directly.
 *
 * `items` is the CURRENT page. The table only ever hands over ids of its rows, so an id is turned back into its item
 * there (the context stores items, not ids). Two kinds of operation:
 * - `toggle` (ctrl/cmd click, a checkbox) accumulates: it adds or removes just that item and keeps everything else,
 *   including items of other pages and selected collections.
 * - `selectOnly`, `selectAll` and `clear` REPLACE the whole selection: they clear items AND collections first, then
 *   select the given items. So a plain click, a drag, a shift range, the header checkbox and "uncheck all" all start over.
 *
 * `selected`, `size` and `active` describe the selected ITEMS across all pages (collections are not in them; the toolbar's
 * own count, `approxCount`, includes those). The returned object changes only when the selection does; the mutating methods read the latest
 * context through `useEvent`, so they are stable.
 */
export function useLibraryListSelection(items: LibraryItem[]): IdSelection<number> {
  const context = useSelection()
  const { selectedItems } = context

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const selected = useMemo(() => new Set(selectedItems.keys()), [selectedItems])

  const toggle = useEvent((id: number) => {
    const item = context.selectedItems.get(id) ?? itemsById.get(id)
    if (item) context.toggleItem(item)
  })
  const replaceWith = useEvent((ids: number[]) => {
    const picked = ids.flatMap((id) => itemsById.get(id) ?? [])
    context.clear()
    if (picked.length > 0) context.selectItems(picked)
  })
  const selectAll = useEvent((ids: number[]) => replaceWith(ids))
  const selectOnly = useEvent((id: number) => replaceWith([id]))
  const clear = useEvent(() => context.clear())
  // Read while rendering (the table draws `selected` from it), so it must follow this render's selection, not a ref.
  const isSelected = useCallback((id: number) => selected.has(id), [selected])

  return useMemo<IdSelection<number>>(
    () => ({ selected, isSelected, toggle, clear, selectAll, selectOnly, size: selected.size, active: selected.size > 0 }),
    [selected, isSelected, toggle, clear, selectAll, selectOnly],
  )
}
