// Pure logic for the skin's touch mode (the item page's video player on a phone or tablet), kept out of the
// component so it can be unit tested without the DOM or real timers. See PlayerSkin.tsx for the wiring and
// docs/architecture.md ("Media player skin") for why it is built on pointer events.

export type InputKind = "mouse" | "touch"

/**
 * The input kind of one pointer event: `touch` and `pen` mean touch mode, `mouse` means mouse mode. Anything
 * else (an empty or unknown pointerType, e.g. a synthetic event) keeps the previous kind. Decided per event, not
 * per device, so a laptop with a touch screen switches back and forth with whatever was used last.
 */
export function inputKindFromPointerType(pointerType: string | null | undefined, prev: InputKind): InputKind {
  if (pointerType === "touch" || pointerType === "pen") return "touch"
  if (pointerType === "mouse") return "mouse"
  return prev
}

/** The guess before any pointer event arrived: a coarse primary pointer (a phone or tablet) starts in touch mode. */
export function initialInputKind(matchMedia: ((query: string) => { matches: boolean }) | undefined): InputKind {
  try {
    return matchMedia?.("(pointer: coarse)").matches ? "touch" : "mouse"
  } catch {
    return "mouse"
  }
}

export type TapZone = "left" | "middle" | "right"

/** Which third of the frame a tap landed in. An empty frame (or a non-finite position) counts as the middle. */
export function tapZone(x: number, left: number, width: number): TapZone {
  if (!(width > 0) || !Number.isFinite(x) || !Number.isFinite(left)) return "middle"
  const f = (x - left) / width
  if (f < 1 / 3) return "left"
  if (f >= 2 / 3) return "right"
  return "middle"
}

/** A press counts as a tap only when it ended within `slopPx` of where it started (else it was a drag or scroll). */
export function isTap(downX: number, downY: number, upX: number, upY: number, slopPx: number): boolean {
  return Math.hypot(upX - downX, upY - downY) <= slopPx
}

export interface TapConfig {
  /** A second tap within this many ms of the first (inclusive) is a double tap. */
  doubleTapMs: number
  /** While a skip streak is running, a tap on the same side within this many ms of the last one (inclusive) skips again. */
  accumulateMs: number
  /** Seconds per skip. */
  skipSeconds: number
}

export interface TapState {
  /** A first tap whose single/double decision is still open. */
  pending: { t: number; zone: TapZone } | null
  /** A running double-tap skip streak: further taps on the same side keep adding to it. */
  streak: { t: number; zone: "left" | "right"; total: number } | null
}

export const INITIAL_TAP_STATE: TapState = { pending: null, streak: null }

export interface TapResult {
  state: TapState
  /** An earlier tap turned out to be a single tap (its window had already expired when this one arrived): toggle the controls. */
  single: boolean
  /** Seek by `delta` seconds now; `total` is the streak's running total for the indicator (negative for the left side). */
  skip: { delta: number; total: number; zone: "left" | "right" } | null
  /** This tap is pending: call `resolveTapTimeout` once `doubleTapMs` have passed. */
  wait: boolean
}

/**
 * Feeds one tap (time `t` in ms, the zone it landed in) through the single / double / accumulated-skip machine:
 *  - during a skip streak, a tap on the same side within `accumulateMs` skips again immediately (+10, +20, +30…);
 *    a tap elsewhere, or after the streak went stale, ends it and starts over as a fresh first tap;
 *  - a second tap within `doubleTapMs` of a pending one is a double tap: the left or right third starts a skip
 *    streak, the middle third does nothing (both taps are consumed, so the controls don't toggle);
 *  - otherwise the tap becomes pending; it is a single tap once the window expires (`resolveTapTimeout`).
 */
export function feedTap(state: TapState, t: number, zone: TapZone, cfg: TapConfig): TapResult {
  let single = false
  let pending = state.pending
  // A pending tap whose window already expired (its timer was late) was a single tap.
  if (pending && t - pending.t > cfg.doubleTapMs) {
    single = true
    pending = null
  }

  const streak = state.streak
  if (streak && t - streak.t <= cfg.accumulateMs) {
    if (zone === streak.zone) {
      const delta = (zone === "left" ? -1 : 1) * cfg.skipSeconds
      const total = streak.total + delta
      return { state: { pending: null, streak: { t, zone, total } }, single, skip: { delta, total, zone }, wait: false }
    }
    // A tap elsewhere ends the streak; it counts as a fresh first tap below.
  }

  if (pending) {
    // The double tap.
    if (zone === "middle") return { state: { pending: null, streak: null }, single, skip: null, wait: false }
    const delta = (zone === "left" ? -1 : 1) * cfg.skipSeconds
    return { state: { pending: null, streak: { t, zone, total: delta } }, single, skip: { delta, total: delta, zone }, wait: false }
  }

  return { state: { pending: { t, zone }, streak: null }, single, skip: null, wait: true }
}

/**
 * The pending tap's timer fired at time `now`: once the double-tap window has passed it is a single tap. Called
 * early (before the window passed) it changes nothing, so a late second tap is still a double tap.
 */
export function resolveTapTimeout(state: TapState, now: number, cfg: TapConfig): { state: TapState; single: boolean } {
  if (!state.pending || now - state.pending.t <= cfg.doubleTapMs) return { state, single: false }
  return { state: { ...state, pending: null }, single: true }
}

/** Where a skip lands: clamped to [0, duration]; with an unknown duration (NaN, Infinity, 0) only the lower bound applies. */
export function skipTarget(current: number, delta: number, duration: number): number {
  const from = Number.isFinite(current) ? current : 0
  const max = Number.isFinite(duration) && duration > 0 ? duration : Infinity
  return Math.min(Math.max(from + delta, 0), max)
}

/** The skip indicator's text: "+10 s", "−30 s" (a real minus sign, like the other on-screen messages). */
export function formatSkip(total: number): string {
  return `${total < 0 ? "−" : "+"}${Math.abs(total)} s`
}

/** Touch mode shows an unmute button while the media is muted or at volume 0 (phones have hardware volume keys, a page can't see them). */
export function showUnmuteButton(touch: boolean, muted: boolean, volume: number): boolean {
  return touch && (muted || volume === 0)
}

/**
 * What the unmute button does: at volume 0 it sets the volume to 1 (which also clears muted); otherwise, when
 * muted, it toggles mute off. Null when there is nothing to undo.
 */
export function unmuteAction(muted: boolean, volume: number): "volume" | "unmute" | null {
  if (volume === 0) return "volume"
  return muted ? "unmute" : null
}

export type FullscreenMode = "frame" | "native" | "none"

/**
 * How the player goes fullscreen:
 *  - "frame": the Fullscreen API on the skin's frame (video and controls), the normal case;
 *  - "native": the <video>'s own `webkitEnterFullscreen` (iPhone Safari, where `document.fullscreenEnabled` is
 *    false); the browser's native player takes over and the skin is not visible there;
 *  - "none": no fullscreen button.
 * `fullscreenEnabled` undefined means the browser doesn't say (old browsers, test DOMs): the frame is tried, as before.
 */
export function fullscreenMode(i: { fullscreenEnabled: boolean | undefined; canRequest: boolean; canWebkitEnter: boolean }): FullscreenMode {
  if (i.fullscreenEnabled !== false && i.canRequest) return "frame"
  if (i.canWebkitEnter) return "native"
  if (i.fullscreenEnabled === undefined) return "frame"
  return "none"
}
