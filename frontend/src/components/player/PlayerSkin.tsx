import { useCallback, type CSSProperties, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { AlertTriangle, Loader2, Music, Pause, Play } from "lucide-react"
import { PlayerControls, type PlayerActions } from "./PlayerControls"
import { clamp, digitToTime, formatSpeed, seekBy, stepSpeed, stepVolume } from "./playerMath"
import {
  PLAYER_CLICK_DELAY_MS,
  PLAYER_COMPACT_INSET_PX,
  PLAYER_COVER_PX,
  PLAYER_FLASH_MS,
  PLAYER_HIDE_DELAY_MS,
  PLAYER_OSD_MS,
  PLAYER_SEEK_STEP_LARGE_S,
  PLAYER_SEEK_STEP_S,
  PLAYER_SPEEDS,
  PLAYER_VOLUME_STEP,
  playerCssVars,
} from "./playerTheme"
import { PLAYER_HOT_ZONE_FRACTION } from "./playerTheme"
import { computeShowBar, isPointerOnBar } from "./playerVisibility"
import { useMediaState } from "./useMediaState"

// A control skin around a host-owned <video>/<audio>: the host renders the element (as `children`),
// keeps its ref, handlers, autoplay and resume logic, and passes the ref here. The skin only
// listens to and drives that element — it never replaces it, so everything attached to it keeps
// working. Remount it (via `key`) whenever the host remounts the element.
//
// Volume/mute persistence is the host's usePersistedVolume (localStorage, shared with the compare
// player); playback speed deliberately resets to 1× with every new element.

const isTypingTarget = (t: EventTarget | null) => {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !(t instanceof HTMLInputElement && t.type === "range")
}

export function PlayerSkin({
  mediaRef,
  kind,
  variant,
  title,
  artist,
  coverUrl,
  className = "",
  children,
}: {
  mediaRef: RefObject<HTMLMediaElement | null>
  kind: "video" | "audio"
  variant: "full" | "compact"
  /** Audio only: shown beside/under the cover. */
  title?: string
  artist?: string
  coverUrl?: string | null
  /** Sizing of the frame (the host decides how tall the player is). */
  className?: string
  children: ReactNode
}) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null) // portal target for the speed menu (stays inside the fullscreen frame)
  const state = useMediaState(mediaRef)
  const overlay = kind === "video"
  const compact = variant === "compact"
  const allowFullscreen = overlay && !compact && (typeof document === "undefined" || document.fullscreenEnabled !== false)

  const [active, setActive] = useState(true) // recent pointer/keyboard activity
  const [pointerOnBar, setPointerOnBar] = useState(false) // from geometry on each move, not enter/leave events
  const [kbFocus, setKbFocus] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [flash, setFlash] = useState<{ id: number; playing: boolean } | null>(null)
  const [osd, setOsd] = useState<{ id: number; text: string } | null>(null)
  const setFrame = useCallback((node: HTMLDivElement | null) => {
    frameRef.current = node
    setFrameEl(node)
  }, [])
  const barRef = useRef<HTMLDivElement>(null)
  const hoveredRef = useRef(false)
  const moves = useRef({ frame: 0, doc: 0, last: 0 }) // for the ?playerDebug=1 readout only
  const pointerFocusRef = useRef(false) // focus came from a mouse/touch press, not the keyboard
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const osdTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const counter = useRef(0)
  // TEMPORARY diagnostics: ?playerDebug=1 shows the values behind showBar (to be removed once the fullscreen bar report is settled).
  const debug = useMemo(() => typeof location !== "undefined" && new URLSearchParams(location.search).get("playerDebug") === "1", [])
  const [, setDebugTick] = useState(0)
  useEffect(() => {
    if (!debug) return
    const t = setInterval(() => setDebugTick((n) => n + 1), 200)
    return () => clearInterval(t)
  }, [debug])

  const bump = useCallback(() => {
    setActive(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setActive(false), PLAYER_HIDE_DELAY_MS)
  }, [])

  useEffect(() => {
    // Initially visible (state starts true); just arm the hide timer.
    hideTimer.current = setTimeout(() => setActive(false), PLAYER_HIDE_DELAY_MS)
    const timers = [hideTimer, clickTimer, osdTimer, flashTimer]
    return () => timers.forEach((t) => clearTimeout(t.current))
  }, [])

  // Every pointer move (on the frame, and on the document while fullscreen) wakes the bar. "Pointer on the bar" is
  // decided from geometry here, not from pointerenter/leave, which don't fire when the bar moves under a still pointer.
  const onPointerActivity = useCallback(
    (e: { clientX: number; clientY: number }) => {
      hoveredRef.current = true
      setPointerOnBar(isPointerOnBar(e.clientX, e.clientY, barRef.current?.getBoundingClientRect(), frameRef.current?.getBoundingClientRect(), PLAYER_HOT_ZONE_FRACTION))
      bump()
    },
    [bump],
  )

  const showOsd = useCallback((text: string) => {
    setOsd({ id: ++counter.current, text })
    clearTimeout(osdTimer.current)
    osdTimer.current = setTimeout(() => setOsd(null), PLAYER_OSD_MS)
  }, [])

  const actions: PlayerActions = useMemo(() => {
    const el = () => mediaRef.current
    const togglePlay = () => {
      const m = el()
      if (!m) return
      if (m.paused) {
        void m.play()?.catch(() => {})
        if (overlay) setFlash({ id: ++counter.current, playing: true })
      } else {
        m.pause()
        if (overlay) setFlash({ id: ++counter.current, playing: false })
      }
      clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlash(null), PLAYER_FLASH_MS)
      bump() // a click or key that toggles playback also wakes the bar (it then stays while paused)
    }
    const seek = (s: number) => {
      const m = el()
      if (m) m.currentTime = s
    }
    const setVolume = (v: number) => {
      const m = el()
      if (!m) return
      m.volume = clamp(v, 0, 1)
      if (v > 0 && m.muted) m.muted = false
    }
    const toggleMute = () => {
      const m = el()
      if (!m) return
      m.muted = !m.muted
      showOsd(m.muted ? "Muted" : `Volume ${Math.round(m.volume * 100)}%`)
    }
    const setRate = (r: number) => {
      const m = el()
      if (!m) return
      m.playbackRate = r
      showOsd(formatSpeed(r))
    }
    const toggleFullscreen = () => {
      const f = frameRef.current
      if (!f) return
      if (document.fullscreenElement) void document.exitFullscreen?.()
      else void f.requestFullscreen?.()?.catch(() => {})
    }
    return { togglePlay, seek, setVolume, toggleMute, setRate, toggleFullscreen }
  }, [mediaRef, overlay, showOsd, bump])

  // Fullscreen is on the frame (video + controls), not the <video>, so the skin stays visible.
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === frameRef.current)
      // The layout just changed under a (probably still) pointer, so any "pointer on the bar" belief is stale.
      setPointerOnBar(false)
      bump()
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [bump])

  // While fullscreen, a move anywhere wakes the bar even if the frame itself doesn't receive the event.
  useEffect(() => {
    if (!isFullscreen) return
    const onMove = (e: MouseEvent) => {
      moves.current.doc++
      moves.current.last = Date.now()
      onPointerActivity(e)
    }
    document.addEventListener("pointermove", onMove)
    document.addEventListener("mousemove", onMove)
    return () => {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("mousemove", onMove)
    }
  }, [isFullscreen, onPointerActivity])

  // Keyboard shortcuts: only while the player is focused or hovered, never while typing, never with Ctrl/Alt/Meta.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const frame = frameRef.current
      const m = mediaRef.current
      if (!frame || !m || e.defaultPrevented) return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (isTypingTarget(e.target)) return
      const inside = frame.contains(document.activeElement)
      if (!inside && !hoveredRef.current) return
      const target = e.target instanceof HTMLElement ? e.target : null
      // A focused button/menu item activates itself with Space/Enter; don't also toggle playback.
      if (target && frame.contains(target) && (e.key === " " || e.key === "Enter") && target.closest("button, [role=menuitem], [role=menuitemradio], [role=slider]")) return
      if (target?.closest("[role=menu]")) return

      const dur = m.duration
      const key = e.key
      let handled = true
      switch (true) {
        case key === " " || key === "k" || key === "K":
          actions.togglePlay()
          break
        case key === "ArrowLeft" || key === "ArrowRight" || key === "j" || key === "J" || key === "l" || key === "L": {
          const dir = key === "ArrowLeft" || key === "j" || key === "J" ? -1 : 1
          const big = e.shiftKey || /^[jJlL]$/.test(key)
          const delta = dir * (big ? PLAYER_SEEK_STEP_LARGE_S : PLAYER_SEEK_STEP_S)
          actions.seek(seekBy(m.currentTime, delta, dur))
          showOsd(`${delta > 0 ? "+" : "−"}${Math.abs(delta)}s`)
          break
        }
        case key === "ArrowUp" || key === "ArrowDown": {
          const v = stepVolume(m.muted ? 0 : m.volume, key === "ArrowUp" ? 1 : -1, PLAYER_VOLUME_STEP)
          actions.setVolume(v)
          showOsd(v === 0 ? "Muted" : `Volume ${Math.round(v * 100)}%`)
          break
        }
        case key === "m" || key === "M":
          actions.toggleMute()
          break
        case (key === "f" || key === "F") && allowFullscreen:
          actions.toggleFullscreen()
          break
        case key === "<" || key === ">": {
          const r = stepSpeed(m.playbackRate, key === ">" ? 1 : -1, PLAYER_SPEEDS)
          actions.setRate(r)
          break
        }
        case /^[0-9]$/.test(key): {
          if (!(Number.isFinite(dur) && dur > 0)) {
            handled = false
            break
          }
          actions.seek(digitToTime(Number(key), dur))
          showOsd(`${Number(key) * 10}%`)
          break
        }
        default:
          handled = false
      }
      if (handled) {
        e.preventDefault()
        bump()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [mediaRef, actions, allowFullscreen, bump, showOsd])

  // Click toggles playback; a double-click goes fullscreen instead (the delayed single click is cancelled).
  const onSurfaceClick = () => {
    if (!allowFullscreen) return actions.togglePlay()
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(actions.togglePlay, PLAYER_CLICK_DELAY_MS)
  }
  const onSurfaceDoubleClick = () => {
    clearTimeout(clickTimer.current)
    if (allowFullscreen) actions.toggleFullscreen()
  }

  const showBar = computeShowBar({ overlay, paused: state.paused, active, pointerOnBar, menuOpen, keyboardFocus: kbFocus })
  const hideCursor = isFullscreen && !showBar && !state.paused
  const progress = state.duration > 0 ? clamp(state.currentTime / state.duration, 0, 1) : 0
  const vars = {
    ...playerCssVars(),
    ...(compact ? { "--player-bar-inset": `${PLAYER_COMPACT_INSET_PX}px` } : {}),
  }

  const bar = (
    <div
      ref={barRef}
      data-slot="player-bar"
      data-visible={showBar}
      className={
        overlay
          ? `absolute inset-x-(--player-bar-inset) bottom-(--player-bar-inset) z-20 rounded-(--player-bar-radius) p-(--player-bar-padding) transition-opacity duration-(--player-fade) motion-reduce:transition-none ${showBar ? "opacity-100" : "pointer-events-none opacity-0"}`
          : "relative z-20 w-full rounded-(--player-bar-radius) p-(--player-bar-padding)"
      }
      style={{
        background: `color-mix(in oklab, var(--player-scrim) calc(var(${overlay ? "--player-bar-opacity" : "--player-bar-opacity-static"}) * 100%), transparent)`,
        backdropFilter: "blur(var(--player-bar-blur))",
        WebkitBackdropFilter: "blur(var(--player-bar-blur))",
      }}
      onFocus={() => setKbFocus(!pointerFocusRef.current)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKbFocus(false)
      }}
    >
      <PlayerControls
        variant={variant}
        state={state}
        actions={actions}
        showSpeed={!compact}
        showFullscreen={allowFullscreen}
        isFullscreen={isFullscreen}
        onMenuOpenChange={setMenuOpen}
        menuContainer={frameEl}
      />
    </div>
  )

  const overlays = (
    <>
      {state.waiting && !state.error && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status" aria-label="Buffering">
          <Loader2 className="size-9 animate-spin text-(--player-fg) drop-shadow" aria-hidden />
        </div>
      )}
      {flash && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" aria-hidden data-slot="player-flash">
          <div
            key={flash.id}
            className="player-flash flex size-(--player-flash-size) items-center justify-center rounded-full bg-(--player-scrim) text-(--player-fg)"
          >
            {flash.playing ? <Play className="size-1/2" fill="currentColor" /> : <Pause className="size-1/2" fill="currentColor" />}
          </div>
        </div>
      )}
      {osd && (
        <div
          key={osd.id}
          role="status"
          data-slot="player-osd"
          className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-lg bg-(--player-scrim) px-3 py-1.5 text-sm font-medium text-(--player-fg) tabular-nums"
        >
          {osd.text}
        </div>
      )}
      {state.error && (
        <div
          role="alert"
          data-slot="player-error"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-(--player-scrim) p-4 text-center text-(--player-fg)"
        >
          <AlertTriangle className="size-8" aria-hidden />
          <p className="text-sm font-semibold">This file can't be played in the browser</p>
          {state.error.message && <p className="max-w-sm text-xs opacity-80">{state.error.message}</p>}
        </div>
      )}
    </>
  )

  const debugReadout = debug && (
    <pre className="pointer-events-none absolute left-2 top-12 z-40 max-w-[90%] whitespace-pre-wrap rounded bg-black/80 p-2 font-mono text-[11px] leading-tight text-lime-300" data-slot="player-debug">
      {JSON.stringify({ paused: state.paused, active, pointerOnBar, menuOpen, kbFocus, isFullscreen, showBar, waiting: state.waiting, frameMoves: moves.current.frame, docMoves: moves.current.doc, lastMoveMsAgo: moves.current.last ? Date.now() - moves.current.last : null }, null, 1)}
    </pre>
  )

  const frameProps = {
    ref: setFrame,
    tabIndex: 0,
    role: "group" as const,
    "aria-label": kind === "video" ? "Video player" : "Audio player",
    "data-slot": "player",
    "data-variant": variant,
    "data-kind": kind,
    style: vars as CSSProperties,
    onPointerMove: (e: { clientX: number; clientY: number }) => {
      moves.current.frame++
      moves.current.last = Date.now()
      onPointerActivity(e)
    },
    onPointerDown: onPointerActivity,
    // Capture on the frame (not the bar) so a press in the speed menu, which is portaled into the frame, counts too.
    onPointerDownCapture: () => (pointerFocusRef.current = true),
    onKeyDownCapture: () => (pointerFocusRef.current = false),
    onPointerEnter: () => (hoveredRef.current = true),
    onPointerLeave: () => {
      hoveredRef.current = false
      setPointerOnBar(false)
    },
    onFocus: bump,
  }
  const frameBase = "player-skin relative isolate select-none text-(--player-fg) outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"

  if (overlay) {
    return (
      <div {...frameProps} className={`${frameBase} overflow-hidden bg-black ${hideCursor ? "cursor-none" : ""} ${className}`}>
        {children}
        <div className="absolute inset-0 z-0" aria-hidden data-slot="player-surface" onClick={onSurfaceClick} onDoubleClick={onSurfaceDoubleClick} />
        {overlays}
        {debugReadout}
        {!showBar && !state.error && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-(--player-hairline) bg-(--player-track-bg)" aria-hidden data-slot="player-hairline">
            <div className="h-full bg-(--player-accent)" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        {bar}
      </div>
    )
  }

  const cover = (size: "lg" | "sm") =>
    size === "lg" ? (
      <div className="aspect-square h-full max-h-72 w-auto overflow-hidden rounded-lg bg-neutral-800 shadow-lg">
        {coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover" /> : <Placeholder />}
      </div>
    ) : (
      <div className="shrink-0 overflow-hidden rounded bg-neutral-800" style={{ width: PLAYER_COVER_PX, height: PLAYER_COVER_PX }}>
        {coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover" /> : <Placeholder small />}
      </div>
    )

  if (compact) {
    return (
      <div {...frameProps} className={`${frameBase} space-y-2 p-3 ${className}`}>
        <div className="flex items-center gap-2">
          {cover("sm")}
          <div className="min-w-0 flex-1">
            {title && <p className="truncate text-xs font-medium text-foreground">{title}</p>}
            {artist && <p className="truncate text-xs text-muted-foreground">{artist}</p>}
          </div>
        </div>
        {children}
        {bar}
        {overlays}
      </div>
    )
  }

  return (
    <div {...frameProps} className={`${frameBase} flex flex-col items-center justify-center gap-4 p-8 ${className}`}>
      {cover("lg")}
      <div className="text-center">
        {title && <p className="text-base font-medium">{title}</p>}
        {artist && <p className="text-sm opacity-70">{artist}</p>}
      </div>
      {children}
      <div className="w-full max-w-md">{bar}</div>
      {overlays}
    </div>
  )
}

function Placeholder({ small = false }: { small?: boolean }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-(--player-fg)">
      <Music className={small ? "size-4 opacity-30" : "size-16 opacity-30"} aria-hidden />
    </div>
  )
}
