/**
 * Grows a small control's tap area to 44x44 CSS px on touch (`pointer-coarse`) without changing its size or layout: an
 * invisible, absolutely positioned ::after centred on the control (the control becomes `relative`). The inset assumes
 * a 14 px icon (14 + 2 x 15 = 44); for a control of another size use `touchHitArea` (below). A mouse never sees it.
 */
export const TOUCH_HIT_AREA =
  "pointer-coarse:relative pointer-coarse:after:absolute pointer-coarse:after:-inset-[15px] pointer-coarse:after:content-['']"

/**
 * Rendered sizes (px) of the hover-revealed controls this covers, mapped to their ::after insets ((44 - size) / 2). The
 * class names are written out in full because Tailwind only emits classes it can find as literal strings.
 */
const HIT_AREA_BY_SIZE = {
  // 12 px icon + p-0.5
  16: "pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5 pointer-coarse:after:content-['']",
  // size-5 checkbox with border-2: the inset is measured from the padding box, so 12 + 2 px of border
  20: "pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5 pointer-coarse:after:content-['']",
  // 16 px icon + p-1
  24: "pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']",
  // 14 px icon + p-1.5
  26: "pointer-coarse:after:absolute pointer-coarse:after:-inset-[9px] pointer-coarse:after:content-['']",
} as const

export type TouchHitSize = keyof typeof HIT_AREA_BY_SIZE

/**
 * A 44x44 tap area for a control that is exactly `size` px square and already positioned (`absolute`, which is what
 * every hover-revealed tile control is). Unlike `TOUCH_HIT_AREA` it does not add `relative`, which would override
 * the control's own `absolute` on touch.
 */
export function touchHitArea(size: TouchHitSize): string {
  return HIT_AREA_BY_SIZE[size]
}

/**
 * For a control that is `opacity-0` until hover: with touch there is no hover, so it is always shown there. Only
 * `pointer-coarse:` variants, so the mouse reveal (`group-hover:` / `focus-visible:`) is untouched. `disabled:` is
 * restated because the coarse variant would otherwise win over `disabled:opacity-50`.
 */
export const TOUCH_REVEAL = "pointer-coarse:opacity-100 pointer-coarse:disabled:opacity-50"

/** `TOUCH_REVEAL` plus a 44x44 tap area, for a hover-revealed icon button of `size` px. */
export function touchRevealedHitArea(size: TouchHitSize): string {
  return `${TOUCH_REVEAL} ${touchHitArea(size)}`
}
