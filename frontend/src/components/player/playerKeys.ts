// Keyboard scopes for the compare page: which key presses the page-level (global) handler acts on. Pure
// decision logic; the DOM facts are gathered by describeKeyTarget.

export const isTypingTarget = (t: EventTarget | null) => {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !(t instanceof HTMLInputElement && t.type === "range"))
}

/** What the page needs to know about the element a key press landed on. */
export interface KeyTarget {
  tag: string
  role: string | null
  inputType: string | null
  /** Inside an open menu (the speed menu): the menu owns every key. */
  inMenu: boolean
}

export function describeKeyTarget(target: EventTarget | null): KeyTarget | null {
  if (!(target instanceof HTMLElement)) return null
  return {
    tag: target.tagName,
    role: target.getAttribute("role"),
    inputType: target instanceof HTMLInputElement ? target.type : null,
    inMenu: !!target.closest("[role=menu]"),
  }
}

const SLIDER_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"])
const PRESS_ROLES = new Set(["button", "switch", "checkbox", "radio", "tab", "menuitem", "menuitemradio", "menuitemcheckbox"])

/** True when the focused element handles this key itself, so the global handler must not also act on it. */
export function targetHandlesKey(target: KeyTarget | null, key: string): boolean {
  if (!target) return false
  if (target.inMenu) return true
  const slider = target.role === "slider" || target.inputType === "range"
  if (slider) return SLIDER_KEYS.has(key)
  if (target.tag === "BUTTON" || (target.role !== null && PRESS_ROLES.has(target.role))) return key === " " || key === "Enter"
  if (target.tag === "A") return key === "Enter"
  return false
}

export type GlobalCommand =
  | { type: "toggle" }
  | { type: "seek"; direction: 1 | -1; shift: boolean }
  | { type: "volume"; direction: 1 | -1 }
  | { type: "mute" }
  | { type: "speed"; direction: 1 | -1 }
  | { type: "fullscreen" }

export interface KeyScopeInput {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  defaultPrevented: boolean
  /** The target is a text field etc. */
  typing: boolean
  /** Focus is in a cell's player: that cell handles its own keys (the global scope stays out). */
  inCell: boolean
  target: KeyTarget | null
}

/**
 * Who handles this key press: a command for the global scope (all cells), or `null` when the page must stay out
 * (modifier held, typing, already handled, a focused cell owns it, or the focused control handles the key itself).
 */
export function resolveGlobalKey(i: KeyScopeInput): GlobalCommand | null {
  if (i.defaultPrevented || i.ctrlKey || i.altKey || i.metaKey || i.typing || i.inCell) return null
  if (targetHandlesKey(i.target, i.key)) return null
  switch (i.key) {
    case " ":
    case "k":
    case "K":
      return { type: "toggle" }
    case "ArrowLeft":
      return { type: "seek", direction: -1, shift: i.shiftKey }
    case "ArrowRight":
      return { type: "seek", direction: 1, shift: i.shiftKey }
    case "ArrowUp":
      return { type: "volume", direction: 1 }
    case "ArrowDown":
      return { type: "volume", direction: -1 }
    case "m":
    case "M":
      return { type: "mute" }
    case "<":
      return { type: "speed", direction: -1 }
    case ">":
      return { type: "speed", direction: 1 }
    case "f":
    case "F":
      return { type: "fullscreen" }
    default:
      return null
  }
}
