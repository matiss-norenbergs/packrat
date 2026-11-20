// Pure helpers for the player's diagnostic modes (see PlayerDebug.tsx). Both modes are URL-only and do nothing
// (no DOM, no timers, no listeners) when the parameter is absent.
//
//   ?playerDebug=1    an on-screen box over the video with the state values and a rolling transition log
//   ?playerDebug=log  the same values and transitions as console.info lines prefixed "[player]", with no DOM
//                     element at all, so it doesn't change how the video is composited

export type PlayerDebugMode = "off" | "box" | "log"

export function parsePlayerDebug(search: string): PlayerDebugMode {
  const v = new URLSearchParams(search).get("playerDebug")?.trim().toLowerCase()
  return v === "1" ? "box" : v === "log" ? "log" : "off"
}

export const DEBUG_LOG_LIMIT = 12
export const DEBUG_LOG_PREFIX = "[player]"

export interface TransitionEntry {
  at: number
  text: string
}

/** Appends an entry stamped in ms relative to the first entry ever logged; keeps only the last `limit`. */
export function appendTransition(entries: readonly TransitionEntry[], text: string, now: number, t0: number | null, limit = DEBUG_LOG_LIMIT): { entries: TransitionEntry[]; t0: number } {
  const base = t0 ?? now
  return { entries: [...entries, { at: Math.round(now - base), text }].slice(-limit), t0: base }
}

export function formatTransition(e: TransitionEntry): string {
  return `${String(e.at).padStart(6)}ms ${e.text}`
}

/** The console line for a transition: `[player] 1234ms showBar=true`. */
export function consoleLine(e: TransitionEntry): string {
  return `${DEBUG_LOG_PREFIX} ${e.at}ms ${e.text}`
}

/** Buckets a computed opacity so a fade logs as three states instead of dozens. */
export function opacityBucket(opacity: number): "0" | "fading" | "1" {
  return opacity <= 0.01 ? "0" : opacity >= 0.99 ? "1" : "fading"
}

/** One observation of the bar's DOM, as logged. */
export function describeBar(dataVisible: string | null, opacity: number, visibility: string): string {
  return `dom=${dataVisible} opacity=${opacityBucket(opacity)} visibility=${visibility}`
}
