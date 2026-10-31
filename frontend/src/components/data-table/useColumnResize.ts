import { useLayoutEffect, useRef, useState } from "react"
import type { MouseEvent, PointerEvent } from "react"
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from "./columns"
import { useEvent } from "./useEvent"

interface Session {
  key: string
  pointerId: number
  startX: number
  startWidth: number
  min: number
  /** The width of the last move; `moved` is false until it differs from the start. */
  last: number
  moved: boolean
  restoreBody: () => void
}

/**
 * Drag-to-resize for one column at a time, modelled on CollapsiblePanel's handle. The handle's pointer events capture
 * the pointer, so the drag also ends when the button is released outside the header or the window. While dragging,
 * `drag` holds the live width (the table renders it in the header and colgroup, the memoized rows are untouched);
 * `onCommit` is called once on release with the final width, and not at all for a plain click, a pointercancel or
 * an unmount. The body gets `col-resize` and no text selection for the duration and gets both back however it ends.
 */
export function useColumnResize(onCommit: (key: string, px: number) => void) {
  const [drag, setDrag] = useState<{ key: string; width: number } | null>(null)
  const session = useRef<Session | null>(null)
  const commit = useEvent(onCommit)

  const finish = (e: PointerEvent<HTMLElement>, apply: boolean) => {
    const s = session.current
    if (!s || e.pointerId !== s.pointerId) return
    session.current = null
    s.restoreBody()
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDrag(null)
    if (apply && s.moved) commit(s.key, s.last)
  }

  // Restore the body styles if the table goes away mid-drag.
  useLayoutEffect(
    () => () => {
      session.current?.restoreBody()
      session.current = null
    },
    [],
  )

  /** Props for the handle of column `key`, whose current width is `width` and which may not get narrower than `min`. */
  const handleProps = (key: string, width: number, min: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 && e.pointerType === "mouse") return
      if (session.current) return
      // No text selection, no focus change, and the press never reaches the sort button or a row.
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const prevSelect = document.body.style.userSelect
      const prevCursor = document.body.style.cursor
      document.body.style.userSelect = "none"
      document.body.style.cursor = "col-resize"
      session.current = {
        key,
        pointerId: e.pointerId,
        startX: e.clientX,
        startWidth: width,
        min,
        last: width,
        moved: false,
        restoreBody: () => {
          document.body.style.userSelect = prevSelect
          document.body.style.cursor = prevCursor
        },
      }
      setDrag({ key, width })
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = session.current
      if (!s || e.pointerId !== s.pointerId) return
      const next = widthAt(s, e.clientX)
      s.last = next
      if (next !== s.startWidth) s.moved = true
      setDrag({ key: s.key, width: next })
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => finish(e, true),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => finish(e, false),
    // Capture lost without a pointerup (the handle left the DOM, or the browser took the pointer): same as cancel.
    onLostPointerCapture: (e: PointerEvent<HTMLElement>) => finish(e, false),
    // A click on the handle must not reach the header (a sort button is its sibling, but be safe about the cell).
    onClick: (e: MouseEvent) => e.stopPropagation(),
  })

  return { drag, handleProps }
}

export type ColumnResizeHandleProps = ReturnType<ReturnType<typeof useColumnResize>["handleProps"]>

function widthAt(s: Session, clientX: number) {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, s.min, Math.round(s.startWidth + clientX - s.startX)))
}
