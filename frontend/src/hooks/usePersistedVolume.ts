import { useEffect, useRef } from "react"

const STORAGE_KEY = "packrat:player-volume"

// Volume changes on every slider drag, so it's saved client-side via
// localStorage on the native `volumechange` event rather than round-tripping
// to the backend settings table like a deliberate setting would.
export function usePersistedVolume<T extends HTMLMediaElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const { volume, muted } = JSON.parse(saved)
        if (typeof volume === "number") el.volume = volume
        if (typeof muted === "boolean") el.muted = muted
      } catch {
        // corrupt/old value — ignore, keep the element's default
      }
    }

    const onVolumeChange = () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: el.volume, muted: el.muted }))
    }
    el.addEventListener("volumechange", onVolumeChange)
    return () => el.removeEventListener("volumechange", onVolumeChange)
  }, [])

  return ref
}
