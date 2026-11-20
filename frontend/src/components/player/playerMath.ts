// Pure helpers for the media player skin (no DOM, no React) so they can be unit tested.

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

const finite = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)

/** 83 -> "1:23", 3725 -> "1:02:05". Non-finite or negative -> "0:00". */
export function formatTime(seconds: number): string {
  const total = Math.floor(finite(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`

/** 83 -> "1 minute 23 seconds" (spoken form for aria-valuetext). */
export function spokenDuration(seconds: number): string {
  const total = Math.floor(finite(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts: string[] = []
  if (h > 0) parts.push(plural(h, "hour"))
  if (m > 0) parts.push(plural(m, "minute"))
  if (s > 0 || parts.length === 0) parts.push(plural(s, "second"))
  return parts.join(" ")
}

/** "1 minute 23 seconds of 45 minutes". Falls back to the position alone while the duration is unknown. */
export function seekValueText(current: number, duration: number): string {
  if (!(Number.isFinite(duration) && duration > 0)) return spokenDuration(current)
  return `${spokenDuration(current)} of ${spokenDuration(duration)}`
}

/** Fraction (0-1) of the track the pointer is at, clamped; flips for right-to-left layouts. */
export function pointerFraction(clientX: number, left: number, width: number, rtl = false): number {
  if (!(width > 0)) return 0
  const f = clamp((clientX - left) / width, 0, 1)
  return rtl ? 1 - f : f
}

/** Time the pointer maps to on a seek bar. */
export function pointerToTime(clientX: number, left: number, width: number, duration: number, rtl = false): number {
  if (!(Number.isFinite(duration) && duration > 0)) return 0
  return pointerFraction(clientX, left, width, rtl) * duration
}

/** Seek by delta seconds, clamped to [0, duration] (unbounded above while the duration is unknown). */
export function seekBy(current: number, delta: number, duration: number): number {
  const max = Number.isFinite(duration) && duration > 0 ? duration : Infinity
  return clamp(current + delta, 0, max)
}

/** Digit key 0-9 -> that tenth of the duration. */
export function digitToTime(digit: number, duration: number): number {
  if (!(Number.isFinite(duration) && duration > 0)) return 0
  return (clamp(Math.round(digit), 0, 9) / 10) * duration
}

/** Volume stepped and clamped to [0,1], rounded to avoid float drift (0.1+0.05...). */
export function stepVolume(volume: number, direction: 1 | -1, step: number): number {
  return clamp(Math.round((volume + direction * step) * 1000) / 1000, 0, 1)
}

/** Next slower/faster entry of the speed list; stays at the ends. A rate not in the list snaps to the nearest step in that direction. */
export function stepSpeed(rate: number, direction: 1 | -1, speeds: readonly number[]): number {
  if (direction === 1) return speeds.find((s) => s > rate + 1e-9) ?? speeds[speeds.length - 1]
  for (let i = speeds.length - 1; i >= 0; i--) if (speeds[i] < rate - 1e-9) return speeds[i]
  return speeds[0]
}

/** 1 -> "1×", 1.25 -> "1.25×". */
export function formatSpeed(rate: number): string {
  return `${Number(rate.toFixed(2))}×`
}

/** Buffered ranges as [startFraction, endFraction] pairs. */
export function bufferedFractions(ranges: { length: number; start(i: number): number; end(i: number): number } | null | undefined, duration: number): Array<[number, number]> {
  if (!ranges || !(Number.isFinite(duration) && duration > 0)) return []
  const out: Array<[number, number]> = []
  for (let i = 0; i < ranges.length; i++) {
    out.push([clamp(ranges.start(i) / duration, 0, 1), clamp(ranges.end(i) / duration, 0, 1)])
  }
  return out
}

/** Human message for a failed media element. */
export function describeMediaError(error: { code: number; message?: string } | null | undefined): string {
  switch (error?.code) {
    case 1: // MEDIA_ERR_ABORTED
      return "Playback was interrupted."
    case 2: // MEDIA_ERR_NETWORK
      return "A network error stopped the file from loading."
    case 3: // MEDIA_ERR_DECODE
      return "The file is damaged or uses features this browser can't decode."
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return "The file's format or codec isn't supported by this browser."
    default:
      return error?.message ? error.message : ""
  }
}
