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

/** Interactive content that keeps a cell from showing the overflow tooltip: everything except plain links. */
export const TOOLTIP_BLOCKING_SELECTOR = CONTROL_SELECTORS.join(", ")

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
