import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { armFocusReturn, noteContextSelect, resetFocusReturn, restoreFocusAfterDialog } from "@/lib/focusReturn"

// DOM-level tests of the state machine: dialogs are bare elements carrying the attributes the module looks for.
let origin: HTMLButtonElement
let toolbar: HTMLButtonElement
beforeEach(() => {
  resetFocusReturn()
  document.body.innerHTML = '<main><button id="origin">row</button><button id="toolbar">Add</button></main>'
  origin = document.getElementById("origin") as HTMLButtonElement
  toolbar = document.getElementById("toolbar") as HTMLButtonElement
})
afterEach(() => {
  document.body.innerHTML = ""
})

function openDialog() {
  const d = document.createElement("div")
  d.setAttribute("data-slot", "dialog-content")
  d.setAttribute("data-state", "open")
  document.body.appendChild(d)
  return d
}
/** A menu item chosen on the origin control, then the dialog it opens. */
function menuOpenedDialog() {
  origin.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }))
  noteContextSelect()
  const d = openDialog()
  armFocusReturn()
  return d
}
const closeEvent = () => new Event("focus", { cancelable: true })

describe("focus return origin", () => {
  it("returns to the menu's origin when its dialog closes", () => {
    menuOpenedDialog().remove()
    const e = closeEvent()
    restoreFocusAfterDialog(e)
    expect(origin).toHaveFocus()
    expect(e.defaultPrevented).toBe(true)
  })

  it("a stale origin (earlier dialog dropped without a close event) is not used by a dialog opened from a toolbar button", () => {
    menuOpenedDialog().remove() // vanished: restoreFocusAfterDialog never ran
    const d = openDialog() // opened by the toolbar button, nothing pending
    armFocusReturn()
    d.remove()
    const e = closeEvent()
    restoreFocusAfterDialog(e)
    expect(e.defaultPrevented).toBe(false) // Radix's default then returns focus to the toolbar button
    expect(origin).not.toHaveFocus()
  })

  it("keeps the origin across a chain (confirm -> picker) until the last dialog closes", () => {
    const first = menuOpenedDialog()
    const second = openDialog() // opened from inside the first, nothing pending
    armFocusReturn()
    first.remove()
    const mid = closeEvent()
    restoreFocusAfterDialog(mid) // the second is still open: keep waiting
    expect(mid.defaultPrevented).toBe(false)
    expect(origin).not.toHaveFocus()
    second.remove()
    const last = closeEvent()
    restoreFocusAfterDialog(last)
    expect(origin).toHaveFocus()
    expect(last.defaultPrevented).toBe(true)
  })

  it("a menu-opened dialog while another is open takes the new origin", () => {
    openDialog()
    const d = menuOpenedDialog()
    d.remove()
    document.querySelector("[data-slot=dialog-content]")?.remove()
    restoreFocusAfterDialog(closeEvent())
    expect(origin).toHaveFocus()
    void toolbar
  })
})
