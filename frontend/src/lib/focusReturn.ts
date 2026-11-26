// Returns keyboard focus to where the user was when a dialog opened from a menu item closes.
//
// Radix returns focus from a dialog to "whatever was focused when it opened": the menu item that opened it, which
// unmounts with its menu, so focus fell to <body> and keyboard users restarted from the top of the page. Here:
//   1. selecting a dropdown / context-menu item records the control that opened the menu (the "⋮" trigger, or the row /
//      focused element of a right-click) as a *pending origin*;
//   2. a dialog that opens within ORIGIN_TTL_MS of that arms it (DialogContent / AlertDialogContent call `armFocusReturn`);
//   3. when the last open dialog closes (`restoreFocusAfterDialog`, from onCloseAutoFocus) the origin gets focus back,
//      or, when it is gone or cannot take focus (deleted item, card menu hidden during a selection), its table / grid
//      region, then <main>. Never <body>.
// Dialogs not opened from a menu have nothing armed and behave as before. A chain of dialogs (confirm -> picker) keeps
// the armed origin until the last one closes. Everything is in this module so no dialog needs its own wiring.

interface Origin {
  el: HTMLElement | null
  region: HTMLElement | null
  at: number
}

const ORIGIN_TTL_MS = 1500
// A table's scroll container, or a view that marks itself as the place focus falls back to.
const REGION = "[data-focus-region], [data-slot=table-container]"
const OPEN_DIALOG = "[data-slot=dialog-content][data-state=open], [data-slot=alert-dialog-content][data-state=open]"

let pending: Origin | null = null
let armed: Origin | null = null
let contextOrigin: Origin | null = null

const makeOrigin = (el: HTMLElement | null): Origin => ({ el, region: el?.closest<HTMLElement>(REGION) ?? null, at: Date.now() })

/** The control that opened the menu an item belongs to: a menu's content is labelled by its trigger, sub-menus chain up. */
function menuTrigger(item: HTMLElement): HTMLElement | null {
  let menu = item.closest<HTMLElement>("[role=menu]")
  for (let guard = 0; menu && guard < 8; guard++) {
    const trigger = document.getElementById(menu.getAttribute("aria-labelledby") ?? "")
    if (!trigger) return null
    const parent = trigger.closest<HTMLElement>("[role=menu]")
    if (!parent) return trigger
    menu = parent
  }
  return null
}

/** A dropdown-menu item was selected. */
export function noteDropdownSelect(item: HTMLElement | null) {
  pending = item ? makeOrigin(menuTrigger(item)) : null
}

/** A context-menu item was selected: the origin is whatever the last `contextmenu` event pointed at. */
export function noteContextSelect() {
  pending = contextOrigin && Date.now() - contextOrigin.at < 10 * 60_000 ? { ...contextOrigin, at: Date.now() } : null
}

// A right-click remembers its row (a mouse has no focus to go back to); a keyboard-opened menu (Shift+F10, the Menu key)
// remembers the focused element inside it.
if (typeof document !== "undefined") {
  document.addEventListener(
    "contextmenu",
    (e) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
      const row = target?.closest<HTMLElement>("tr[data-row-id]") ?? null
      const keyboard = e.button !== 2
      const el = keyboard && active && (!row || row.contains(active)) ? active : (row ?? target)
      contextOrigin = makeOrigin(el)
    },
    true,
  )
}

/** A dialog opened: take the origin of the menu item that was just selected, if any (otherwise keep an armed chain). */
export function armFocusReturn() {
  if (pending && Date.now() - pending.at < ORIGIN_TTL_MS) armed = pending
  pending = null
}

function tryFocus(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected) return false
  // A region / row is not a tab stop; make it focusable by script only.
  if (!el.matches("a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]")) el.setAttribute("tabindex", "-1")
  el.focus({ preventScroll: false })
  return document.activeElement === el
}

/** The `onCloseAutoFocus` of a dialog: put focus back on the armed origin instead of letting it fall to <body>. */
export function restoreFocusAfterDialog(e: Event) {
  if (!armed) return
  if (document.querySelector(OPEN_DIALOG)) return // another dialog took over (a chain): keep the origin for the last one
  const origin = armed
  armed = null
  const ok = tryFocus(origin.el) || tryFocus(origin.region) || tryFocus(document.querySelector<HTMLElement>("main"))
  if (ok) e.preventDefault()
}

/** For tests. */
export function resetFocusReturn() {
  pending = null
  armed = null
  contextOrigin = null
}
