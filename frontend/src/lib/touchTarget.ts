/**
 * Grows a small control's tap area to 44x44 CSS px on touch (`pointer-coarse`) without changing its size or layout: an
 * invisible, absolutely positioned ::after centred on the control (the control becomes `relative`). The inset assumes
 * a 14 px icon (14 + 2 x 15 = 44); pass a different one through `touchHitInset` for another size. A mouse never sees it.
 */
export const TOUCH_HIT_AREA =
  "pointer-coarse:relative pointer-coarse:after:absolute pointer-coarse:after:-inset-[15px] pointer-coarse:after:content-['']"
