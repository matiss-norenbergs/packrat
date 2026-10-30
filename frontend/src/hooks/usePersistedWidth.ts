import { useCallback, useState } from "react"

function readWidth(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

// Persists a pixel width (a resizable side panel) to localStorage under
// `key`. Read once at mount; invalid stored values (non-numbers, NaN, zero,
// negatives) are ignored and the value resolves to `defaultValue`, as it does
// while nothing is stored. Unlike usePersistedOpen the write happens in the
// setter, not an effect, so callers decide when to persist (e.g. on pointer
// release rather than on every pointer move). Setting `null` removes the
// stored key, so the value follows `defaultValue` again (including a changed
// default) rather than freezing today's default into storage.
export function usePersistedWidth(key: string, defaultValue: number): [number, (w: number | null) => void] {
  const [stored, setStored] = useState<number | null>(() => readWidth(key))

  const set = useCallback(
    (w: number | null) => {
      setStored(w)
      try {
        if (w === null) localStorage.removeItem(key)
        else localStorage.setItem(key, String(w))
      } catch {
        // storage unavailable: the width still applies for this session
      }
    },
    [key],
  )

  return [stored ?? defaultValue, set]
}
