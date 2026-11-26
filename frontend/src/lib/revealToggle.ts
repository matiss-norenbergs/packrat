import type { HTMLAttributes, KeyboardEvent } from "react"

/**
 * Props that make an existing element (a private item's thumbnail, its hashed title) a keyboard-operable
 * "reveal / hide" toggle without changing its box: `role="button"`, in the tab order, Enter / Space, `aria-pressed`
 * and a state-aware label. A wrapping `<button>` would change the layout of the ~20 places that size the image,
 * so the element itself becomes the button (still a plain click for the mouse).
 *
 * `what` is generic on purpose ("image", "title"): the label is read aloud and sits in the DOM, so it must never
 * carry the item's real name.
 */
export function revealToggleProps(
  revealed: boolean,
  onToggle: () => void,
  what: string,
): Pick<HTMLAttributes<HTMLElement>, "role" | "tabIndex" | "aria-pressed" | "aria-label" | "onClick" | "onKeyDown"> {
  return {
    role: "button",
    tabIndex: 0,
    "aria-pressed": revealed,
    "aria-label": `${revealed ? "Hide" : "Reveal"} ${what}`,
    onClick: onToggle,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      // Only the element's own keys: a key pressed in a control nested inside it is that control's.
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return
      e.preventDefault()
      onToggle()
    },
  }
}

/** Utility classes for the focus ring of a reveal toggle that is text (an image gets `data-reveal-focus` on its parent instead). */
export const REVEAL_TEXT_FOCUS_CLASS = "rounded-sm outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
