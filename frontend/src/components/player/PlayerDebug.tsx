import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { appendTransition, consoleLine, describeBar, formatTransition, type PlayerDebugMode, type TransitionEntry } from "./playerDiagnostics"

// Permanent diagnostic tool for compositing problems with the control bar (a translucent element over a playing
// video can flicker or go unpainted depending on the video and the GPU). Mounted by PlayerSkin only when the URL
// has ?playerDebug=1 or ?playerDebug=log, so without the parameter none of this exists: no DOM, no timers, no
// listeners.
//
// It records the values behind the bar's visibility (`values`, `showBar`), pointer-event counters, the active
// ?playerFx flags, the video's pixel size, and a log of transitions of showBar (React state), the bar's DOM
// data-visible, and its computed opacity bucket / visibility. If the bar flashes: showBar flipping true->false
// within ~200 ms is a logic problem; showBar staying true while the bar isn't painted is a painting problem.
//
//   box  renders a <pre> over the video. That extra element repaints every few frames and can itself stop
//        Chromium from putting the video on a hardware overlay, i.e. it can HIDE the bug being chased.
//   log  renders nothing and writes the same information to the console (console.info, "[player]" prefix),
//        so it doesn't change how the video is composited. Prefer this one to observe a flicker.
const POLL_MS = 50
const BOX_VIEW_MS = 250

export interface PointerCounters {
  frame: number
  doc: number
  last: number
}

export function PlayerDebug({
  mode,
  values,
  showBar,
  barRef,
  mediaRef,
  moves,
  fx,
}: {
  mode: Exclude<PlayerDebugMode, "off">
  values: Record<string, boolean>
  showBar: boolean
  barRef: RefObject<HTMLDivElement | null>
  mediaRef: RefObject<HTMLMediaElement | null>
  moves: RefObject<PointerCounters>
  fx: ReadonlySet<string>
}) {
  const entries = useRef<TransitionEntry[]>([])
  const t0 = useRef<number | null>(null)
  const [view, setView] = useState({ log: "", counts: "" })

  const push = useCallback(
    (text: string) => {
      const r = appendTransition(entries.current, text, performance.now(), t0.current)
      entries.current = r.entries
      t0.current = r.t0
      if (mode === "log") console.info(consoleLine(r.entries[r.entries.length - 1]))
    },
    [mode],
  )

  useEffect(() => {
    push(`showBar=${showBar}`)
  }, [showBar, push])

  // Every other state value, logged when any of them changes.
  const valuesJson = JSON.stringify(values)
  useEffect(() => {
    push(`state ${valuesJson}`)
  }, [valuesJson, push])

  useEffect(() => {
    let lastBar = ""
    let lastVideo = ""
    let lastView = ""
    let lastViewAt = 0
    const tick = () => {
      const bar = barRef.current
      if (bar) {
        const cs = getComputedStyle(bar)
        const cur = describeBar(bar.getAttribute("data-visible"), Number(cs.opacity), cs.visibility)
        if (cur !== lastBar) {
          lastBar = cur
          push(cur)
        }
      }
      const v = mediaRef.current as HTMLVideoElement | null
      const size = v && "videoWidth" in v ? `${v.videoWidth}x${v.videoHeight}` : ""
      if (size !== lastVideo) {
        lastVideo = size
        push(`video=${size || "n/a"} fx=[${[...fx].join(",")}]`)
      }
      if (mode !== "box") return
      const now = performance.now()
      if (now - lastViewAt < BOX_VIEW_MS) return
      lastViewAt = now
      const m = moves.current
      const counts = `frameMoves=${m.frame} docMoves=${m.doc} lastMoveMsAgo=${m.last ? Date.now() - m.last : "-"} video=${size} fx=[${[...fx].join(",")}]`
      const next = counts + "\n" + entries.current.map(formatTransition).join("\n")
      if (next !== lastView) {
        lastView = next
        setView({ counts, log: entries.current.map(formatTransition).join("\n") })
      }
    }
    const t = setInterval(tick, POLL_MS)
    return () => clearInterval(t)
  }, [barRef, mediaRef, moves, fx, mode, push])

  if (mode === "log") return null
  return (
    <pre className="pointer-events-none absolute left-2 top-12 z-40 max-w-[90%] whitespace-pre-wrap rounded bg-black/80 p-2 font-mono text-[11px] leading-tight text-lime-300" data-slot="player-debug">
      {"debug box on: it can mask flicker, use ?playerDebug=log to observe without it\n"}
      {JSON.stringify(values)}
      {"\n" + view.counts + "\n" + view.log}
    </pre>
  )
}
