import { useEffect, useRef, useState } from "react"
import type { PointerEvent, ReactNode } from "react"
import { createPortal } from "react-dom"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SORT_BUTTON_ATTR, TOOLTIP_BLOCKING_SELECTOR } from "./interactive"
import type { ColumnDef } from "./types"
import { useEvent } from "./useEvent"

/** Same as the app's other tooltips (TooltipProvider's default delayDuration). */
const SHOW_DELAY_MS = 200

interface Tip {
  rect: DOMRect
  text: string
}

// Many cells truncate in an inner block (`<p className="truncate">`), so the cell itself may fit while a descendant
// does not. Inline descendants report 0 for both sizes and never count.
function isCutOff(cell: HTMLElement): boolean {
  if (cell.scrollWidth > cell.clientWidth) return true
  for (const el of cell.querySelectorAll("*")) {
    if (el.scrollWidth > el.clientWidth) return true
  }
  return false
}

// The text the tooltip would show for a hovered cell or header, or null when it must not show one (an excluded column
// or cell, or the content fits). `innerText` keeps a two-line cell as two lines; jsdom has none, hence the textContent
// fallback. A header (`th`) shows its own text; the sort button inside a sortable header is not a blocking control.
function tooltipTextFor<T>(cell: HTMLElement, column: ColumnDef<T> | undefined, row: T | undefined): string | null {
  if (!column || column.tooltip === false || column.wrap || column.type === "icon" || column.type === "switch") return null
  const header = cell.tagName === "TH"
  const blocked = Array.from(cell.querySelectorAll(TOOLTIP_BLOCKING_SELECTOR)).some((el) => !(header && el.hasAttribute(SORT_BUTTON_ATTR)))
  if (blocked) return null
  if (!isCutOff(cell)) return null
  const text = !header && column.tooltipText && row !== undefined ? column.tooltipText(row) : (cell.innerText ?? cell.textContent ?? "")
  // Block children (two `<p>`) come out of innerText with a blank line between them; keep one line break.
  return text.replace(/\n{2,}/g, "\n").trim() || null
}

/**
 * One tooltip for the whole table, driven by a delegated listener on the head and one on the body: when the pointer
 * enters a cell or header whose text is cut off (measured on entry only, never continuously) it shows the full text after the usual delay. It closes
 * on mouse down (and stays off until the button is released, so a drag selection never pops tooltips), scroll,
 * context menu, Escape and when the pointer leaves the head or the body, and never stops or alters any event, so row selection,
 * drags and the context menu are untouched. The anchor is a fixed, pointer-less box over the cell, portaled to
 * `document.body` (a transformed dialog would otherwise move it).
 */
export function useOverflowTooltip<T>(columns: ColumnDef<T>[], findRow: (id: string) => T | undefined) {
  const [tip, setTip] = useState<Tip | null>(null)
  const cellRef = useRef<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressed = useRef(false)

  const close = useEvent(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    cellRef.current = null
    setTip(null)
  })

  const onPointerOver = useEvent((e: PointerEvent<HTMLElement>) => {
    const target = e.target as Element
    // The resize handle sits on the header's edge; hovering it is not hovering the label.
    const cell = target.closest("[data-resize-handle]") ? null : target.closest<HTMLElement>("td[data-col], th[data-col]")
    if (cell === cellRef.current) return
    close()
    if (!cell || !e.currentTarget.contains(cell)) return
    cellRef.current = cell
    if (suppressed.current) return
    const column = columns.find((c) => c.key === cell.dataset.col)
    const rowId = cell.closest<HTMLElement>("tr[data-row-id]")?.dataset.rowId
    const text = tooltipTextFor(cell, column, rowId === undefined ? undefined : findRow(rowId))
    if (text == null) return
    timer.current = setTimeout(() => {
      timer.current = undefined
      setTip({ rect: cell.getBoundingClientRect(), text })
    }, SHOW_DELAY_MS)
  })

  useEffect(() => {
    const press = () => {
      suppressed.current = true
      close()
    }
    const release = () => {
      suppressed.current = false
    }
    const closeOnKey = (e: KeyboardEvent) => e.key === "Escape" && close()
    window.addEventListener("pointerdown", press, true)
    window.addEventListener("mousedown", press, true)
    window.addEventListener("pointerup", release, true)
    window.addEventListener("mouseup", release, true)
    window.addEventListener("scroll", close, true)
    window.addEventListener("contextmenu", close, true)
    window.addEventListener("keydown", closeOnKey, true)
    return () => {
      window.removeEventListener("pointerdown", press, true)
      window.removeEventListener("mousedown", press, true)
      window.removeEventListener("pointerup", release, true)
      window.removeEventListener("mouseup", release, true)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("contextmenu", close, true)
      window.removeEventListener("keydown", closeOnKey, true)
      clearTimeout(timer.current)
    }
  }, [close])

  const node: ReactNode = tip
    ? createPortal(
        <Tooltip open onOpenChange={(open) => !open && close()}>
          <TooltipTrigger asChild>
            <span
              aria-hidden
              style={{ position: "fixed", left: tip.rect.left, top: tip.rect.top, width: tip.rect.width, height: tip.rect.height, pointerEvents: "none" }}
            />
          </TooltipTrigger>
          <TooltipContent className="whitespace-pre-line break-words">{tip.text}</TooltipContent>
        </Tooltip>,
        document.body,
      )
    : null

  // The same listener serves the header and the body; `th[data-col]` exists only on the columns' own headers (not the
  // selection column or the filler).
  const props = { onPointerOver, onPointerLeave: close }
  return { bodyProps: props, headProps: props, node }
}
