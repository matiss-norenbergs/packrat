import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  allMuted,
  globalSeekPercentTarget,
  globalSeekTarget,
  PERCENT_SCALE,
  percentPosition,
  rafThrottle,
  relativeSeekDelta,
  snapshotOf,
  summarizeGroup,
  type GroupSummary,
  type SyncMode,
} from "@/components/player/groupMedia"
import { clamp, formatSpeed, seekBy, stepSpeed, stepVolume } from "@/components/player/playerMath"
import { PLAYER_DEFAULT_SPEED, PLAYER_OSD_MS, PLAYER_SEEK_STEP_LARGE_S, PLAYER_SEEK_STEP_S, PLAYER_SPEEDS, PLAYER_VOLUME_STEP } from "@/components/player/playerTheme"
import type { GlobalCommand } from "@/components/player/playerKeys"

const SUMMARY_EVENTS = ["play", "pause", "ended", "timeupdate", "durationchange", "loadedmetadata", "seeked", "emptied"] as const
const EMPTY: GroupSummary = { anyPlaying: false, duration: 0, currentTime: 0, referenceDuration: 0 }
// Mirrors a set of media elements as one group: "any playing", the longest duration and the reference position.
function useGroupSummary(elements: readonly HTMLMediaElement[]): GroupSummary {
  const [summary, setSummary] = useState<GroupSummary>(EMPTY)
  useEffect(() => {
    const update = () => {
      const next = summarizeGroup(elements.map(snapshotOf))
      setSummary((p) =>
        p.anyPlaying === next.anyPlaying &&
        p.duration === next.duration &&
        p.currentTime === next.currentTime &&
        p.referenceDuration === next.referenceDuration
          ? p
          : next,
      )
    }
    update()
    for (const el of elements) for (const ev of SUMMARY_EVENTS) el.addEventListener(ev, update)
    return () => {
      for (const el of elements) for (const ev of SUMMARY_EVENTS) el.removeEventListener(ev, update)
    }
  }, [elements])
  return summary
}

/**
 * The compare page's global controls over the cells' media elements (kept in a ref map; locked cells register
 * nothing and are therefore skipped by everything here). `order` is the items' ids in display order, which
 * decides which cell is "the first".
 *
 * Master volume is a "set all" control: the slider shows the last value set (initially 1). A cell mounted later
 * keeps its own persisted volume unless the master slider was moved this session, then it adopts it. Speed is the
 * last value set (1× on page open) and is also adopted by a cell mounted later.
 *
 * `mode` maps the global seek bar onto the cells (it only changes the mapping, it never seeks or pauses anything):
 * "time" = one absolute time for all (scale: the longest duration), "percent" = the same fraction of each cell's own
 * length (scale: 0-100 points). The bar always works in `seekScale` units; `seekAll` takes the same units.
 */
export function useCompareGroup(order: readonly number[], mode: SyncMode = "time") {
  const mediaRefs = useRef<Map<number, HTMLMediaElement>>(new Map())
  const [version, setVersion] = useState(0)
  const [rate, setRateState] = useState<number>(PLAYER_DEFAULT_SPEED)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMutedState] = useState(false)
  const rateRef = useRef<number>(PLAYER_DEFAULT_SPEED)
  const volumeTouched = useRef(false)
  const volumeRef = useRef(1)
  const [osd, setOsd] = useState<{ id: number; text: string } | null>(null)
  const osdTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const osdCounter = useRef(0)

  const showOsd = useCallback((text: string) => {
    setOsd({ id: ++osdCounter.current, text })
    clearTimeout(osdTimer.current)
    osdTimer.current = setTimeout(() => setOsd(null), PLAYER_OSD_MS)
  }, [])
  useEffect(() => () => clearTimeout(osdTimer.current), [])

  // Stable per-id ref callbacks (a new function each render would unregister and re-register every cell on every render).
  const registrars = useRef<Map<number, (el: HTMLMediaElement | null) => void>>(new Map())
  const registerMedia = useCallback((id: number) => {
    let fn = registrars.current.get(id)
    if (!fn) {
      fn = (el) => {
        const map = mediaRefs.current
        if (el) {
          if (map.get(id) === el) return
          map.set(id, el)
          // A cell mounted later adopts the global speed (and the master volume, once the user has touched it).
          el.defaultPlaybackRate = rateRef.current
          el.playbackRate = rateRef.current
          if (volumeTouched.current) el.volume = volumeRef.current
        } else {
          if (!map.delete(id)) return
        }
        setVersion((v) => v + 1)
      }
      registrars.current.set(id, fn)
    }
    return fn
  }, [])

  const orderKey = order.join(",")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const elements = useMemo(() => order.flatMap((id) => mediaRefs.current.get(id) ?? []), [orderKey, version])
  const elementsRef = useRef(elements)
  elementsRef.current = elements

  const summary = useGroupSummary(elements)

  const playAll = useCallback(() => {
    for (const el of elementsRef.current) void el.play()?.catch(() => {})
  }, [])
  const pauseAll = useCallback(() => {
    for (const el of elementsRef.current) el.pause()
  }, [])

  const modeRef = useRef(mode)
  modeRef.current = mode
  const applySeek = useCallback((v: number) => {
    const percent = modeRef.current === "percent"
    for (const el of elementsRef.current) {
      const target = percent ? globalSeekPercentTarget(v / PERCENT_SCALE, el.duration) : globalSeekTarget(v, el.duration)
      if (target !== null) el.currentTime = target
    }
  }, [])
  const seekThrottle = useMemo(() => rafThrottle(applySeek), [applySeek])
  useEffect(() => () => seekThrottle.cancel(), [seekThrottle])
  // A scrub still waiting for its frame was made in the other mode's units: drop it rather than apply it as the new mode.
  useEffect(() => seekThrottle.cancel(), [mode, seekThrottle])
  /** Scrub (units of `seekScale`): every cell to the same time (clamped per item) or to the same fraction of its own length, throttled to animation frames. */
  const seekAll = seekThrottle.call

  /** What the global seek bar shows: time mode = the reference position over the longest duration; percent mode = the reference's fraction of its own length, 0-100. */
  const seekScale = useMemo(() => {
    if (mode === "time") return { value: summary.currentTime, max: summary.duration }
    return { value: percentPosition(summary.currentTime, summary.referenceDuration) * PERCENT_SCALE, max: elements.length > 0 ? PERCENT_SCALE : 0 }
  }, [mode, summary, elements.length])

  /** Every cell by its own delta from its own current time, so the offsets between cells are kept. */
  const seekAllBy = useCallback(
    (direction: 1 | -1, shift: boolean) => {
      const delta = relativeSeekDelta(direction, shift, PLAYER_SEEK_STEP_S, PLAYER_SEEK_STEP_LARGE_S)
      for (const el of elementsRef.current) el.currentTime = seekBy(el.currentTime, delta, el.duration)
      showOsd(`${delta > 0 ? "+" : "−"}${Math.abs(delta)}s`)
    },
    [showOsd],
  )

  const setVolumeAll = useCallback((v: number, osdText = true) => {
    const next = clamp(v, 0, 1)
    volumeTouched.current = true
    volumeRef.current = next
    setVolumeState(next)
    if (next > 0) setMutedState(false)
    for (const el of elementsRef.current) {
      el.volume = next
      if (next > 0 && el.muted) el.muted = false
    }
    if (osdText) showOsd(next === 0 ? "Muted" : `Volume ${Math.round(next * 100)}%`)
  }, [showOsd])
  const stepVolumeAll = useCallback(
    (direction: 1 | -1) => setVolumeAll(stepVolume(muted ? 0 : volume, direction, PLAYER_VOLUME_STEP)),
    [setVolumeAll, muted, volume],
  )
  const toggleMuteAll = useCallback(() => {
    const els = elementsRef.current
    const next = !(allMuted(els.map((e) => e.muted)) || muted)
    setMutedState(next)
    for (const el of els) el.muted = next
    showOsd(next ? "Muted" : `Volume ${Math.round(volume * 100)}%`)
  }, [muted, volume, showOsd])

  const setRateAll = useCallback(
    (r: number) => {
      rateRef.current = r
      setRateState(r)
      for (const el of elementsRef.current) {
        el.defaultPlaybackRate = r
        el.playbackRate = r
      }
      showOsd(formatSpeed(r))
    },
    [showOsd],
  )
  const stepRateAll = useCallback((direction: 1 | -1) => setRateAll(stepSpeed(rate, direction, PLAYER_SPEEDS)), [setRateAll, rate])

  /** Runs a keyboard command on the whole group (toggle and fullscreen are the page's: it owns Wait-for-ready and the container). */
  const run = useCallback(
    (cmd: Exclude<GlobalCommand, { type: "toggle" | "fullscreen" }>) => {
      switch (cmd.type) {
        case "seek":
          return seekAllBy(cmd.direction, cmd.shift)
        case "volume":
          return stepVolumeAll(cmd.direction)
        case "mute":
          return toggleMuteAll()
        case "speed":
          return stepRateAll(cmd.direction)
      }
    },
    [seekAllBy, stepVolumeAll, toggleMuteAll, stepRateAll],
  )

  return {
    registerMedia,
    summary,
    seekScale,
    rate,
    volume,
    muted,
    osd,
    showOsd,
    hasMedia: elements.length > 0,
    playAll,
    pauseAll,
    seekAll,
    setVolumeAll,
    toggleMuteAll,
    setRateAll,
    run,
  }
}
