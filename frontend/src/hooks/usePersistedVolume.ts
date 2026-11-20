import { useEffect, useRef } from "react"

const STORAGE_KEY = "packrat:player-volume"

// Volume changes on every slider drag, so it's saved client-side via
// localStorage on the native `volumechange` event rather than round-tripping
// to the backend settings table like a deliberate setting would.
//
// resyncKey lets a caller whose owning component never unmounts (e.g.
// MiniPlayerDock, which stays mounted across the whole Browse area and just
// conditionally renders its <audio>/<video> element) force this effect to
// re-attach whenever a *new* media element appears — otherwise the
// mount-only effect below would only ever run once, before any element
// exists, and volume would never sync. Callers whose owning component does
// remount per item (LibraryItemDetail) can omit it; the default `undefined`
// behaves like the old mount-once effect.
export function usePersistedVolume<T extends HTMLMediaElement>(resyncKey?: unknown) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Storage can be unavailable (blocked, private window) — then volume just isn't remembered.
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const { volume, muted } = JSON.parse(saved)
        if (typeof volume === "number") el.volume = Math.min(1, Math.max(0, volume))
        if (typeof muted === "boolean") el.muted = muted
      }
    } catch {
      // corrupt/old value or no storage — ignore, keep the element's default
    }

    const onVolumeChange = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: el.volume, muted: el.muted }))
      } catch {
        // storage unavailable — not remembered
      }
    }
    el.addEventListener("volumechange", onVolumeChange)
    return () => el.removeEventListener("volumechange", onVolumeChange)
  }, [resyncKey])

  return ref
}
