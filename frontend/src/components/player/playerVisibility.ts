// Pure logic for when the control bar is shown, kept out of the component so it can be unit tested.

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
}

/** True when the point is inside the rectangle; an empty (zero-size or missing) rectangle contains nothing. */
export function pointInRect(x: number, y: number, rect: RectLike | null | undefined): boolean {
  if (!rect || rect.right <= rect.left || rect.bottom <= rect.top) return false
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/** True when the pointer is within the bottom `fraction` (0-1) of the frame (the invisible hot zone that wakes the bar). */
export function inHotZone(x: number, y: number, frame: RectLike | null | undefined, fraction: number): boolean {
  if (!frame || frame.right <= frame.left || frame.bottom <= frame.top) return false
  const zoneTop = frame.bottom - (frame.bottom - frame.top) * fraction
  return x >= frame.left && x <= frame.right && y >= zoneTop && y <= frame.bottom
}

/**
 * Whether a pointer at (x, y) counts as "on the bar": inside the bar's bounding box or in the hot zone.
 * Decided from geometry on every move, never from pointerenter/leave, which do not fire when the bar moves
 * under a stationary pointer (entering fullscreen) or while the bar is pointer-events:none.
 */
export function isPointerOnBar(x: number, y: number, bar: RectLike | null | undefined, frame: RectLike | null | undefined, hotZoneFraction: number): boolean {
  return pointInRect(x, y, bar) || inHotZone(x, y, frame, hotZoneFraction)
}

export interface BarVisibilityInput {
  overlay: boolean
  paused: boolean
  active: boolean
  pointerOnBar: boolean
  menuOpen: boolean
  keyboardFocus: boolean
  /**
   * Touch mode: the user tapped the video to hide the controls. Hides them even while paused (a tap toggles them
   * either way); an open menu still keeps them. Cleared by the next activity (a tap, a key, a mouse move).
   */
  dismissed?: boolean
}

/**
 * The bar is always shown when it is not an overlay or a menu is open; otherwise (unless dismissed by a tap) while
 * paused, active, hovered or keyboard focused.
 */
export function computeShowBar(i: BarVisibilityInput): boolean {
  if (!i.overlay || i.menuOpen) return true
  return !i.dismissed && (i.paused || i.active || i.pointerOnBar || i.keyboardFocus)
}

/**
 * Whether a frame is inside the fullscreen subtree: a fullscreen element exists and contains the frame
 * (it may be the frame itself, or an ancestor such as the compare page's container). This, not
 * `fullscreenElement === frame`, decides the no-blur bar paint and cursor hiding, because the blur/overlay
 * flicker comes from the video being fullscreen on screen, whichever element requested fullscreen.
 */
export function isInFullscreen(fullscreenElement: Element | null | undefined, frame: Element | null | undefined): boolean {
  return !!fullscreenElement && !!frame && fullscreenElement.contains(frame)
}
