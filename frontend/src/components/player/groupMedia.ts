// Pure helpers for controlling several media elements as one group (the compare page's global bar).
import { clamp } from "./playerMath"

/** The slice of a media element's state the group controls look at. */
export interface GroupSnapshot {
  paused: boolean
  ended: boolean
  currentTime: number
  duration: number
}

export interface GroupSummary {
  /** True while any element is actually playing (not paused, not ended). */
  anyPlaying: boolean
  /** Longest known duration (0 while none is known). */
  duration: number
  /** Position of the reference element: the first playing one, otherwise the first. */
  currentTime: number
}

const known = (d: number) => Number.isFinite(d) && d > 0

export function snapshotOf(el: Pick<HTMLMediaElement, "paused" | "ended" | "currentTime" | "duration">): GroupSnapshot {
  return { paused: el.paused, ended: el.ended, currentTime: el.currentTime || 0, duration: el.duration }
}

export function isPlayingSnapshot(s: Pick<GroupSnapshot, "paused" | "ended">): boolean {
  return !s.paused && !s.ended
}

/** Index of the element whose position the global seek bar shows: the first playing one, else the first (-1 when empty). */
export function referenceIndex(snaps: readonly Pick<GroupSnapshot, "paused" | "ended">[]): number {
  if (snaps.length === 0) return -1
  const playing = snaps.findIndex(isPlayingSnapshot)
  return playing >= 0 ? playing : 0
}

export function summarizeGroup(snaps: readonly GroupSnapshot[]): GroupSummary {
  const ref = referenceIndex(snaps)
  return {
    anyPlaying: snaps.some(isPlayingSnapshot),
    duration: snaps.reduce((max, s) => (known(s.duration) && s.duration > max ? s.duration : max), 0),
    currentTime: ref < 0 ? 0 : snaps[ref].currentTime,
  }
}

/**
 * Where one element goes when the global seek bar is scrubbed to the absolute time `t`: the same time, but no
 * later than the element's own end (a shorter clip stops at its end). `null` = skip it (duration not known yet).
 */
export function globalSeekTarget(t: number, duration: number): number | null {
  if (!known(duration)) return null
  return clamp(t, 0, duration)
}

/** Seek step of the global relative seek: 5 s, 10 s with Shift. */
export function relativeSeekDelta(direction: 1 | -1, shift: boolean, step: number, largeStep: number): number {
  return direction * (shift ? largeStep : step)
}

/** Whether every element is muted (the next global mute toggle then unmutes). Empty = not muted. */
export function allMuted(muted: readonly boolean[]): boolean {
  return muted.length > 0 && muted.every(Boolean)
}

/** Calls fn at once, then at most once per animation frame with the latest arguments (so six players aren't flooded while dragging). */
export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void): { call: (...args: A) => void; cancel: () => void } {
  let pending: A | null = null
  let handle: number | null = null
  let usedRaf = false
  const schedule = () => {
    const done = () => {
      handle = null
      if (pending) {
        const a = pending
        pending = null
        fn(...a)
        schedule()
      }
    }
    usedRaf = typeof requestAnimationFrame === "function"
    handle = usedRaf ? requestAnimationFrame(done) : (setTimeout(done, 16) as unknown as number)
  }
  return {
    call: (...args: A) => {
      if (handle !== null) {
        pending = args
        return
      }
      fn(...args)
      schedule()
    },
    cancel: () => {
      pending = null
      if (handle !== null) {
        if (usedRaf) cancelAnimationFrame(handle)
        else clearTimeout(handle)
        handle = null
      }
    },
  }
}
