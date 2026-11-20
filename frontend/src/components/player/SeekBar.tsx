import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { bufferedFractions, clamp, formatTime, pointerFraction, seekBy, seekValueText } from "./playerMath"
import { PLAYER_SEEK_STEP_LARGE_S, PLAYER_SEEK_STEP_S } from "./playerTheme"

// The player's seek slider: pointer events (mouse, pen, touch drag), buffered ranges, a floating
// time bubble that follows the pointer, and the ARIA slider contract with arrow-key operation.
export function SeekBar({
  currentTime,
  duration,
  buffered,
  onSeek,
  className = "",
  formatValue,
}: {
  currentTime: number
  duration: number
  buffered: TimeRanges | null
  onSeek: (seconds: number) => void
  className?: string
  /** For a slider that isn't in seconds (the compare bar's percent mode, 0-100): text of a value for the bubble and the ARIA value text. */
  formatValue?: (value: number) => string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null) // fraction under the pointer
  const [drag, setDrag] = useState<number | null>(null) // fraction while dragging
  const dragging = useRef(false) // read by handlers (state would be stale between back-to-back events)
  const known = Number.isFinite(duration) && duration > 0

  const fractionAt = (e: PointerEvent) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return 0
    const rtl = getComputedStyle(trackRef.current!).direction === "rtl"
    return pointerFraction(e.clientX, r.left, r.width, rtl)
  }

  const shownFraction = drag ?? (known ? clamp(currentTime / duration, 0, 1) : 0)
  const bubbleFraction = drag ?? hover
  const ranges = bufferedFractions(buffered, duration)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!known || (e.pointerType === "mouse" && e.button !== 0)) return
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // no active pointer with that id (synthetic events): dragging still works while the pointer stays over the bar
    }
    const f = fractionAt(e)
    dragging.current = true
    setDrag(f)
    onSeek(f * duration)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!known) return
    const f = fractionAt(e)
    setHover(f)
    if (dragging.current) {
      setDrag(f)
      onSeek(f * duration)
    }
  }
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    } catch {
      // already released
    }
    setDrag(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!known || e.ctrlKey || e.altKey || e.metaKey) return
    let target: number | null = null
    const big = e.shiftKey ? PLAYER_SEEK_STEP_LARGE_S : PLAYER_SEEK_STEP_S
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        target = seekBy(currentTime, -big, duration)
        break
      case "ArrowRight":
      case "ArrowUp":
        target = seekBy(currentTime, big, duration)
        break
      case "PageDown":
        target = seekBy(currentTime, -PLAYER_SEEK_STEP_LARGE_S, duration)
        break
      case "PageUp":
        target = seekBy(currentTime, PLAYER_SEEK_STEP_LARGE_S, duration)
        break
      case "Home":
        target = 0
        break
      case "End":
        target = duration
        break
    }
    if (target == null) return
    // The player-level shortcuts must not also act on this key.
    e.preventDefault()
    e.stopPropagation()
    onSeek(target)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={known ? Math.floor(duration) : 0}
      aria-valuenow={Math.floor(drag != null && known ? drag * duration : currentTime)}
      aria-valuetext={
        formatValue
          ? formatValue(drag != null && known ? drag * duration : currentTime)
          : seekValueText(drag != null && known ? drag * duration : currentTime, duration)
      }
      aria-disabled={!known || undefined}
      data-slot="player-seek"
      className={`group/seek relative flex h-(--player-seek-hit) min-w-0 touch-none items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring ${known ? "cursor-pointer" : "cursor-default"} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
    >
      <div
        ref={trackRef}
        className={`relative w-full overflow-hidden rounded-full bg-(--player-track-bg) transition-[height] duration-100 motion-reduce:transition-none ${drag != null ? "h-(--player-track-hover)" : "h-(--player-track) group-hover/seek:h-(--player-track-hover) group-focus-visible/seek:h-(--player-track-hover)"}`}
      >
        {ranges.map(([a, b], i) => (
          <div
            key={i}
            data-slot="player-buffered"
            className="absolute inset-y-0 bg-(--player-fg)"
            style={{ insetInlineStart: `${a * 100}%`, width: `${(b - a) * 100}%`, opacity: "var(--player-buffered-opacity)" }}
          />
        ))}
        <div
          data-slot="player-played"
          className="absolute inset-y-0 start-0 bg-(--player-accent)"
          style={{ width: `${shownFraction * 100}%` }}
        />
      </div>
      <div
        aria-hidden
        className={`pointer-events-none absolute top-1/2 size-(--player-handle) -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--player-fg) shadow-md ring-2 ring-(--player-accent) transition-transform duration-100 motion-reduce:transition-none ${drag != null ? "scale-100" : "scale-0 group-hover/seek:scale-100 group-focus-visible/seek:scale-100"}`}
        style={{ insetInlineStart: `${shownFraction * 100}%` }}
      />
      {bubbleFraction != null && known && (
        <div
          aria-hidden
          data-slot="player-seek-bubble"
          className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 rounded-md bg-(--player-scrim) px-1.5 py-0.5 text-xs font-medium text-(--player-fg) tabular-nums shadow-md"
          style={{ insetInlineStart: `${bubbleFraction * 100}%` }}
        >
          {formatValue ? formatValue(bubbleFraction * duration) : formatTime(bubbleFraction * duration)}
        </div>
      )}
    </div>
  )
}
