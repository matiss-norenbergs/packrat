import { useEffect, useState, type RefObject } from "react"
import { describeMediaError } from "./playerMath"

export interface MediaState {
  paused: boolean
  ended: boolean
  currentTime: number
  duration: number
  buffered: TimeRanges | null
  volume: number
  muted: boolean
  rate: number
  waiting: boolean
  /** Set when the element (or one of its <source>s) failed; message may be empty when the reason is unknown. */
  error: { message: string } | null
}

export const INITIAL_MEDIA_STATE: MediaState = {
  paused: true,
  ended: false,
  currentTime: 0,
  duration: 0,
  buffered: null,
  volume: 1,
  muted: false,
  rate: 1,
  waiting: false,
  error: null,
}

const UPDATE_EVENTS = [
  "play",
  "pause",
  "ended",
  "timeupdate",
  "durationchange",
  "loadedmetadata",
  "progress",
  "volumechange",
  "ratechange",
  "seeking",
  "seeked",
  "emptied",
] as const

function snapshot(el: HTMLMediaElement, prev: MediaState): MediaState {
  return {
    ...prev,
    paused: el.paused,
    ended: el.ended,
    currentTime: el.currentTime || 0,
    duration: el.duration,
    buffered: el.buffered ?? null,
    volume: el.volume,
    muted: el.muted,
    rate: el.playbackRate,
  }
}

// Mirrors a media element's state into React. The element belongs to the host (it keeps its ref,
// handlers and autoplay); this only listens. Error events from <source> children don't bubble,
// so the error listener is a capture listener on the element itself.
export function useMediaState(mediaRef: RefObject<HTMLMediaElement | null>): MediaState {
  const [state, setState] = useState<MediaState>(INITIAL_MEDIA_STATE)

  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    const update = () => setState((p) => snapshot(el, p))
    const setWaiting = (waiting: boolean) => setState((p) => ({ ...snapshot(el, p), waiting }))

    const onWaiting = () => setWaiting(true)
    const onReady = () => setWaiting(false)
    const onError = () => {
      // el.error is null when a <source> failed (NETWORK_NO_SOURCE): then the codec/format is the likely reason.
      const message = el.error ? describeMediaError(el.error) : describeMediaError({ code: 4 })
      setState((p) => ({ ...snapshot(el, p), waiting: false, error: { message } }))
    }
    const onEmptied = () => setState((p) => ({ ...snapshot(el, p), error: null }))

    update()
    for (const ev of UPDATE_EVENTS) el.addEventListener(ev, update)
    el.addEventListener("waiting", onWaiting)
    el.addEventListener("playing", onReady)
    el.addEventListener("canplay", onReady)
    el.addEventListener("seeked", onReady)
    el.addEventListener("emptied", onEmptied)
    el.addEventListener("error", onError, true)
    return () => {
      for (const ev of UPDATE_EVENTS) el.removeEventListener(ev, update)
      el.removeEventListener("waiting", onWaiting)
      el.removeEventListener("playing", onReady)
      el.removeEventListener("canplay", onReady)
      el.removeEventListener("seeked", onReady)
      el.removeEventListener("emptied", onEmptied)
      el.removeEventListener("error", onError, true)
    }
  }, [mediaRef])

  return state
}
