import { useCallback, useState } from "react"

// Panel width limits, in px. The minimum and default are fixed; the maximum is
// half of the row the panel sits in (applied by the panel at render time).
export const PANEL_MIN_WIDTH = 280
export const PANEL_DEFAULT_WIDTH = 320

function readWidth(key: string, defaultValue: number): number {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) && n > 0 ? n : defaultValue
  } catch {
    return defaultValue
  }
}

// Persists a pixel width (a resizable side panel) to localStorage under
// `key`. Read once at mount; invalid stored values (non-numbers, NaN, zero,
// negatives) fall back to `defaultValue`. Unlike usePersistedOpen the write
// happens in the setter, not an effect, so callers decide when to persist
// (e.g. on pointer release rather than on every pointer move).
export function usePersistedWidth(key: string, defaultValue: number = PANEL_DEFAULT_WIDTH): [number, (w: number) => void] {
  const [value, setValue] = useState(() => readWidth(key, defaultValue))

  const set = useCallback(
    (w: number) => {
      setValue(w)
      try {
        localStorage.setItem(key, String(w))
      } catch {
        // storage unavailable: the width still applies for this session
      }
    },
    [key],
  )

  return [value, set]
}
