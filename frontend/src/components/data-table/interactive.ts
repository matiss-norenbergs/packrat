import type { SyntheticEvent } from "react"

/**
 * Elements inside a row that own their pointer behavior: pressing them must not select the row, start a
 * drag, or fire onRowClick / onRowDoubleClick. Custom interactive cells that don't match (a clickable div,
 * a third-party widget) opt out with a `data-no-row-select` attribute on the element or an ancestor in the cell.
 */
const LINK_SELECTOR = "a[href]"

const CONTROL_SELECTORS = [
  "button",
  "input",
  "select",
  "textarea",
  "label",
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  "[data-no-row-select]",
]

export const INTERACTIVE_SELECTOR = [LINK_SELECTOR, ...CONTROL_SELECTORS].join(", ")

/** Marks the sort button of a sortable header: the one control that does not keep the header from showing a tooltip. */
export const SORT_BUTTON_ATTR = "data-sort-button"

/** Interactive content that has no overflow tooltip of its own and is left out of its text: everything except plain links. */
export const TOOLTIP_BLOCKING_SELECTOR = CONTROL_SELECTORS.join(", ")

/** A control of a cell for the overflow tooltip. In a header the sort button is part of the label, not a control. */
export function isBlockingControl(el: Element, header: boolean): boolean {
  return el.matches(TOOLTIP_BLOCKING_SELECTOR) && !(header && el.hasAttribute(SORT_BUTTON_ATTR))
}

/** The nearest control that is `el` or contains it, inside `cell` (see `isBlockingControl`); null when there is none. */
export function closestBlockingControl(el: Element, cell: Element, header: boolean): Element | null {
  for (let c = el.closest(TOOLTIP_BLOCKING_SELECTOR); c && c !== cell && cell.contains(c); c = c.parentElement?.closest(TOOLTIP_BLOCKING_SELECTOR) ?? null) {
    if (isBlockingControl(c, header)) return c
  }
  return null
}

/**
 * True when a row-level pointer event should be left to its target: it came through a React portal (the DOM
 * target isn't inside the row, but synthetic events still bubble to it) or from an interactive element inside the row.
 */
export function isRowEventIgnored(e: SyntheticEvent): boolean {
  const row = e.currentTarget as Element
  const target = e.target as Element
  if (!row.contains(target)) return true
  const interactive = target.closest(INTERACTIVE_SELECTOR)
  return interactive != null && row.contains(interactive)
}
