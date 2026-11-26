import { expect } from "vitest"

/** What counts as a control that must have an accessible name. */
const CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="checkbox"], [role="switch"], [role="tab"], input:not([type="hidden"]), select, textarea, [role="progressbar"], [role="combobox"]'

/**
 * Asserts that every button, link, role=button/checkbox/switch/tab, form control and progress bar inside `container` has an
 * accessible name (via `toHaveAccessibleName`, i.e. dom-accessibility-api's computation: text content, `aria-label`,
 * `aria-labelledby`, `<label>`, `title`, `alt`). Icon-only controls with just a tooltip fail it: a Radix tooltip describes its
 * trigger only while open, never on touch.
 *
 * Pass `except` to skip controls that are named by something the test environment cannot compute.
 */
export function expectControlsNamed(container: HTMLElement, except?: (el: Element) => boolean) {
  const unnamed: string[] = []
  for (const el of container.querySelectorAll(CONTROL_SELECTOR)) {
    if (el.getAttribute("aria-hidden") === "true" || except?.(el)) continue
    try {
      expect(el).toHaveAccessibleName()
    } catch {
      unnamed.push(el.outerHTML.slice(0, 160))
    }
  }
  expect(unnamed, `controls without an accessible name:\n${unnamed.join("\n")}`).toEqual([])
}

/** Asserts that none of the given private strings occurs in the DOM text or in any attribute value (labels, alt, title) of `container`. */
export function expectNoPrivateText(container: HTMLElement, ...secrets: string[]) {
  const html = container.ownerDocument.body.innerHTML
  for (const secret of secrets) expect(html, `"${secret}" leaked into the DOM`).not.toContain(secret)
}
