import { useEffect, useRef, type RefObject } from "react"
import { useUpdateLibraryProgress } from "./useLibrary"

const SAVE_INTERVAL_MS = 10_000
// Below this, a position isn't worth persisting — avoids a stray couple of
// seconds (an accidental open, a quick preview) counting as "in progress"
// and showing up in Continue Watching.
const MIN_POSITION_SECONDS = 5

// Periodically persists how far into playback the user has gotten, powering
// the Browse page's "Continue Watching" row. Callers must only enable this
// for video — music has no "continue watching" concept, so LibraryItemDetail
// passes enabled=false for audio items entirely.
export function usePlaybackProgress<T extends HTMLMediaElement>(mediaRef: RefObject<T | null>, itemId: number, enabled: boolean) {
  const updateProgress = useUpdateLibraryProgress()
  const lastSavedAtRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const el = mediaRef.current
    if (!el) return

    const save = () => {
      const position = Math.floor(el.currentTime)
      if (position < MIN_POSITION_SECONDS) return
      lastSavedAtRef.current = Date.now()
      updateProgress.mutate({ id: itemId, positionSeconds: position })
    }

    const onTimeUpdate = () => {
      if (Date.now() - lastSavedAtRef.current >= SAVE_INTERVAL_MS) save()
    }

    el.addEventListener("timeupdate", onTimeUpdate)
    el.addEventListener("pause", save)
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate)
      el.removeEventListener("pause", save)
      // Also save on unmount (navigating away mid-playback) — otherwise
      // whatever progress happened since the last periodic save is lost.
      save()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, enabled])
}
