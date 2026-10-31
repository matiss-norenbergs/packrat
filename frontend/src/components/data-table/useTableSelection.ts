import { useCallback, useEffect, useRef, useState } from "react"
import type { MouseEvent } from "react"
import type { IdSelection } from "@/hooks/useIdSelection"
import { isRowEventIgnored } from "./interactive"
import type { RowId } from "./types"

export type SelectionMode = "multi" | "single" | "none"

interface Options<T, Id extends RowId> {
  rows: T[]
  getRowId: (row: T) => Id
  mode: SelectionMode
  selection: IdSelection<Id>
}

// Row-pointer selection shared by every list page, on top of a controlled
// useIdSelection so the page's toolbar can read the same state.
//
// multi: mousedown on a row starts a drag and anchors the range; mouseenter on
// later rows while the button is held extends the selection from the anchor
// to the row under the cursor (a window-level mouseup ends the drag even when
// released outside the table). Plain click selects only that row, ctrl/cmd
// toggles it, shift selects the range from the anchor. Presses on interactive
// elements inside the row (checkbox, button, link, input, …, see
// INTERACTIVE_SELECTOR) and events from portals are left alone — the checkbox
// toggles without clearing via its own handler.
// single: a click selects only that row; no drag, ctrl or shift.
export function useTableSelection<T, Id extends RowId>({ rows, getRowId, mode, selection }: Options<T, Id>) {
  const { selectAll, selectOnly, toggle } = selection
  const current = selection.selected
  const [isDragging, setIsDragging] = useState(false)
  const anchorRef = useRef<Id | null>(null)

  useEffect(() => {
    if (!isDragging) return
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [isDragging])

  const rangeIds = useCallback(
    (anchorId: Id, targetId: Id) => {
      const ids = rows.map(getRowId)
      const anchorIdx = ids.indexOf(anchorId)
      const targetIdx = ids.indexOf(targetId)
      if (anchorIdx === -1 || targetIdx === -1) return null
      const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
      return ids.slice(start, end + 1)
    },
    [rows, getRowId],
  )

  // A drag fires mouseenter on every row crossed; setting an identical selection would still allocate a new
  // Set and re-render the table, so only write when the range actually differs.
  const selectRange = (ids: Id[]) => {
    if (ids.length === current.size && ids.every((id) => current.has(id))) return
    selectAll(ids)
  }

  const onRowMouseDown = (e: MouseEvent, id: Id) => {
    if (mode === "none" || e.button !== 0) return
    // Checkbox / radio / buttons / inputs / portal content keep their own behavior (and native focus).
    if (isRowEventIgnored(e)) return
    e.preventDefault() // avoid native text-selection while dragging/shift-clicking

    if (mode === "single") {
      selectOnly(id)
      return
    }

    if (e.shiftKey && anchorRef.current != null) {
      const ids = rangeIds(anchorRef.current, id)
      if (ids) {
        selectRange(ids)
        return
      }
    }

    if (e.ctrlKey || e.metaKey) {
      toggle(id)
      anchorRef.current = id
      return
    }

    anchorRef.current = id
    setIsDragging(true)
    selectOnly(id)
  }

  const onRowMouseEnter = (id: Id) => {
    if (mode !== "multi" || !isDragging || anchorRef.current == null) return
    const ids = rangeIds(anchorRef.current, id)
    if (ids) selectRange(ids)
  }

  return { onRowMouseDown, onRowMouseEnter }
}
