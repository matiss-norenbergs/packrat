import { useCallback, type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { AlertTriangle, ChevronsLeft, ChevronsRight, Loader2, Music, Pause, Play } from "lucide-react"
import { PlayerControls, type PlayerActions } from "./PlayerControls"
import { clamp, digitToTime, formatSpeed, seekBy, stepSpeed, stepVolume } from "./playerMath"
import {
  PLAYER_CLICK_DELAY_MS,
  PLAYER_COMPACT_INSET_PX,
  PLAYER_COVER_PX,
  PLAYER_DOUBLE_TAP_MS,
  PLAYER_FLASH_MS,
  PLAYER_HIDE_DELAY_MS,
  PLAYER_OSD_MS,
  PLAYER_SEEK_STEP_LARGE_S,
  PLAYER_SEEK_STEP_S,
  PLAYER_SKIP_ACCUMULATE_MS,
  PLAYER_SKIP_INDICATOR_MS,
  PLAYER_SPEEDS,
  PLAYER_TAP_SLOP_PX,
  PLAYER_TOUCH_SKIP_S,
  PLAYER_VOLUME_STEP,
  playerCssVars,
} from "./playerTheme"
import { PLAYER_HOT_ZONE_FRACTION } from "./playerTheme"
import { PlayerDebug } from "./PlayerDebug"
import { parsePlayerDebug } from "./playerDiagnostics"
import { barPaint, parsePlayerFx } from "./playerFx"
import { computeShowBar, isInFullscreen, isPointerOnBar, pointInRect } from "./playerVisibility"
import { isTypingTarget } from "./playerKeys"
import { PlayerTouchControls } from "./PlayerTouchControls"
import {
  INITIAL_TAP_STATE,
  feedTap,
  formatSkip,
  fullscreenMode,
  initialInputKind,
  inputKindFromPointerType,
  isTap,
  resolveTapTimeout,
  showUnmuteButton,
  skipTarget,
  tapZone,
  unmuteAction,
  type FullscreenMode,
  type InputKind,
  type TapState,
} from "./playerTouch"
import { useMediaState } from "./useMediaState"

// A control skin around a host-owned <video>/<audio>: the host renders the element (as `children`),
// keeps its ref, handlers, autoplay and resume logic, and passes the ref here. The skin only
// listens to and drives that element — it never replaces it, so everything attached to it keeps
// working. Remount it (via `key`) whenever the host remounts the element.
//
// Volume/mute persistence is the host's usePersistedVolume (localStorage, shared with the compare
// player); playback speed deliberately resets to 1× with every new element.
//
// Touch mode (only the full video variant, i.e. the item page): the last input kind, read from each pointer event's
// pointerType, switches the frame between the desktop bar and PlayerTouchControls. Taps on the video are sequenced
// from pointerdown/up (not click/dblclick, unreliable on touch) by the pure machine in playerTouch.ts: a single tap
// toggles the controls (decided once the double-tap window passed, so a double tap never flickers them), a double tap
// on the left/right third skips 10 s and further taps on that side accumulate.

const TAP_CONFIG = { doubleTapMs: PLAYER_DOUBLE_TAP_MS, accumulateMs: PLAYER_SKIP_ACCUMULATE_MS, skipSeconds: PLAYER_TOUCH_SKIP_S }
// A touch tap is followed by compatibility mouse events and a click; within this long after one, those are ignored.
const TOUCH_GHOST_MS = 1000
const isTouchPointer = (t: string | undefined) => t === "touch" || t === "pen"

export function PlayerSkin({
  mediaRef,
  kind,
  variant,
  title,
  artist,
  coverUrl,
  coverPx = PLAYER_COVER_PX,
  shortcuts = "hover-or-focus",
  titleOverlay,
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
  /** Compact audio only: size of the cover square. */
  coverPx?: number
  /**
   * When the document-level shortcuts act: "hover-or-focus" (default) = while the pointer hovers the player or it
   * has focus; "focus" = only while the frame (or something in it) has focus, never because of the pointer
   * (several players on one page, where hover would be ambiguous).
   */
  shortcuts?: "hover-or-focus" | "focus"
  /** Video only: a title shown in a top-left gradient whenever the control bar is shown, hidden with it. */
  titleOverlay?: string
  /** Sizing of the frame (the host decides how tall the player is). */
  className?: string
  children: ReactNode
}) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null) // portal target for the speed menu (stays inside the fullscreen frame)
  const state = useMediaState(mediaRef)
  const overlay = kind === "video"
  const compact = variant === "compact"
  const focusOnly = shortcuts === "focus"
  const touchCapable = overlay && !compact // the only variant that has a touch mode
  const [inputKind, setInputKind] = useState<InputKind>(() => (typeof window === "undefined" ? "mouse" : initialInputKind(window.matchMedia?.bind(window))))
  const touchMode = touchCapable && inputKind === "touch"
  const [fsMode, setFsMode] = useState<FullscreenMode>(() => detectFullscreenMode(null))
  useEffect(() => setFsMode(detectFullscreenMode(mediaRef.current)), [mediaRef])
  const allowFullscreen = overlay && !compact && fsMode !== "none"

  const [active, setActive] = useState(true) // recent pointer/keyboard activity
  const [pointerOnBar, setPointerOnBar] = useState(false) // from geometry on each move, not enter/leave events
  const [kbFocus, setKbFocus] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false) // this frame is the fullscreen element (the button's icon)
  const [inFullscreen, setInFullscreen] = useState(false) // a fullscreen element exists and contains this frame (paint, cursor)
  const [flash, setFlash] = useState<{ id: number; playing: boolean } | null>(null)
  const [osd, setOsd] = useState<{ id: number; text: string } | null>(null)
  // Touch: the controls were hidden by a tap. Any activity clears it, and so does a play/pause change (the video
  // pausing or ending on its own brings them back).
  const [dismissed, setDismissed] = useState(false)
  const [dismissedPaused, setDismissedPaused] = useState(state.paused)
  if (dismissedPaused !== state.paused) {
    setDismissedPaused(state.paused)
    setDismissed(false)
  }
  const [skip, setSkip] = useState<{ id: number; zone: "left" | "right"; total: number } | null>(null)
  const setFrame = useCallback((node: HTMLDivElement | null) => {
    frameRef.current = node
    setFrameEl(node)
  }, [])
  const barRef = useRef<HTMLDivElement>(null)
  const hoveredRef = useRef(false)
  const moves = useRef({ frame: 0, doc: 0, last: 0 }) // pointer counters for the ?playerDebug readout only (only written when it is on)
  const pointerFocusRef = useRef(false) // focus came from a mouse/touch press, not the keyboard
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const osdTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const tapTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const skipTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const tapState = useRef<TapState>(INITIAL_TAP_STATE)
  const pressRef = useRef<{ id: number; x: number; y: number } | null>(null) // the touch press on the surface
  const lastTouchAt = useRef(0)
  const deferredKind = useRef<string | null>(null) // pointerType of a press on a control, applied when it ends
  const showBarRef = useRef(true)
  const touchModeRef = useRef(touchMode)
  const counter = useRef(0)
  // Diagnostics (see PlayerDebug.tsx / playerFx.ts): only ever active with ?playerDebug=1|log and ?playerFx=… in the URL.
  const fx = useMemo(() => (typeof location === "undefined" ? parsePlayerFx("") : parsePlayerFx(location.search)), [])
  const debugMode = useMemo(() => (typeof location === "undefined" ? "off" : parsePlayerDebug(location.search)), [])

  const bump = useCallback(() => {
    setDismissed(false)
    setActive(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setActive(false), PLAYER_HIDE_DELAY_MS)
  }, [])

  useEffect(() => {
    // Initially visible (state starts true); just arm the hide timer.
    hideTimer.current = setTimeout(() => setActive(false), PLAYER_HIDE_DELAY_MS)
    const timers = [hideTimer, clickTimer, osdTimer, flashTimer, tapTimer, skipTimer]
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
      // No pulse in touch mode: the big center button already shows the new state.
      const pulse = overlay && !touchModeRef.current
      if (m.paused) {
        void m.play()?.catch(() => {})
        if (pulse) setFlash({ id: ++counter.current, playing: true })
      } else {
        m.pause()
        if (pulse) setFlash({ id: ++counter.current, playing: false })
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
      if (fsMode === "native") {
        // iPhone Safari: no Fullscreen API for elements, only the video's own player (the skin isn't shown there).
        ;(el() as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.()
        return
      }
      if (document.fullscreenElement) void document.exitFullscreen?.()
      else void f.requestFullscreen?.()?.catch(() => {})
    }
    return { togglePlay, seek, setVolume, toggleMute, setRate, toggleFullscreen }
  }, [mediaRef, overlay, showOsd, bump, fsMode])

  // Fullscreen is on the frame (video + controls), not the <video>, so the skin stays visible.
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === frameRef.current)
      setInFullscreen(isInFullscreen(document.fullscreenElement, frameRef.current))
      // The layout just changed under a (probably still) pointer, so any "pointer on the bar" belief is stale.
      setPointerOnBar(false)
      bump()
    }
    document.addEventListener("fullscreenchange", onChange)
    // A player mounted while something is already fullscreen (a private cell revealed on the compare page).
    if (document.fullscreenElement) onChange()
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [bump])

  // While fullscreen, a move anywhere wakes the bar even if the frame itself doesn't receive the event. When the
  // fullscreen element is an ancestor (the compare page), only moves over this frame count, or one move would
  // wake every player on the page.
  useEffect(() => {
    if (!inFullscreen) return
    const onMove = (e: MouseEvent) => {
      // A finger on the screen is not "the pointer moved": touch taps are handled by the surface, and the
      // compatibility mouse events that follow a tap must not wake the bar either.
      if (isTouchPointer((e as PointerEvent).pointerType) || Date.now() - lastTouchAt.current < TOUCH_GHOST_MS) return
      if (!isFullscreen && !pointInRect(e.clientX, e.clientY, frameRef.current?.getBoundingClientRect())) return
      if (debugMode !== "off") {
        moves.current.doc++
        moves.current.last = Date.now()
      }
      onPointerActivity(e)
    }
    document.addEventListener("pointermove", onMove)
    document.addEventListener("mousemove", onMove)
    return () => {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("mousemove", onMove)
    }
  }, [inFullscreen, isFullscreen, onPointerActivity, debugMode])

  // Keyboard shortcuts: only while the player is focused (or hovered, unless shortcuts="focus"), never while typing,
  // never with Ctrl/Alt/Meta.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const frame = frameRef.current
      const m = mediaRef.current
      if (!frame || !m || e.defaultPrevented) return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (isTypingTarget(e.target)) return
      const inside = frame.contains(document.activeElement)
      if (!inside && (focusOnly || !hoveredRef.current)) return
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
  }, [mediaRef, actions, allowFullscreen, focusOnly, bump, showOsd])

  // Click toggles playback; a double-click goes fullscreen instead (the delayed single click is cancelled). Mouse
  // only: the click a touch tap is followed by is ignored (taps go through the tap machine below).
  const fromTouch = (e: { nativeEvent: Event }) =>
    touchCapable && (isTouchPointer((e.nativeEvent as PointerEvent).pointerType) || Date.now() - lastTouchAt.current < TOUCH_GHOST_MS)
  const onSurfaceClick = (e: { nativeEvent: Event }) => {
    if (fromTouch(e)) return
    if (!allowFullscreen) return actions.togglePlay()
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(actions.togglePlay, PLAYER_CLICK_DELAY_MS)
  }
  const onSurfaceDoubleClick = (e: { nativeEvent: Event }) => {
    if (fromTouch(e)) return
    clearTimeout(clickTimer.current)
    if (allowFullscreen) actions.toggleFullscreen()
  }

  // Touch taps on the video surface. pointerdown remembers where the finger went down; pointerup decides whether it
  // was a tap (not a drag/scroll) and feeds it to the tap machine. A single tap is only acted on once the double-tap
  // window has passed, so the two taps of a double tap never flash the controls.
  const toggleControls = useCallback(() => {
    if (showBarRef.current) {
      clearTimeout(hideTimer.current)
      setActive(false)
      setDismissed(true)
    } else bump()
  }, [bump])
  const onTapTimeout = useCallback(() => {
    const r = resolveTapTimeout(tapState.current, Date.now(), TAP_CONFIG)
    tapState.current = r.state
    if (r.single) toggleControls()
  }, [toggleControls])
  const onSurfacePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!touchCapable || !isTouchPointer(e.pointerType)) return
    lastTouchAt.current = Date.now()
    pressRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  const onSurfacePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    pressRef.current = null
    if (!touchCapable || !isTouchPointer(e.pointerType) || !press || press.id !== e.pointerId) return
    lastTouchAt.current = Date.now()
    if (!isTap(press.x, press.y, e.clientX, e.clientY, PLAYER_TAP_SLOP_PX)) return
    const r0 = frameRef.current?.getBoundingClientRect()
    const now = Date.now()
    const r = feedTap(tapState.current, now, tapZone(e.clientX, r0?.left ?? 0, r0?.width ?? 0), TAP_CONFIG)
    tapState.current = r.state
    if (r.single) toggleControls()
    if (r.wait) {
      clearTimeout(tapTimer.current)
      tapTimer.current = setTimeout(onTapTimeout, PLAYER_DOUBLE_TAP_MS + 1)
    }
    if (r.skip) {
      clearTimeout(tapTimer.current)
      const m = mediaRef.current
      if (m) actions.seek(skipTarget(m.currentTime, r.skip.delta, m.duration))
      setSkip({ id: ++counter.current, zone: r.skip.zone, total: r.skip.total })
      clearTimeout(skipTimer.current)
      skipTimer.current = setTimeout(() => setSkip(null), PLAYER_SKIP_INDICATOR_MS)
    }
  }
  const onSurfacePointerCancel = () => {
    pressRef.current = null
  }
  const applyDeferredKind = () => {
    const t = deferredKind.current
    deferredKind.current = null
    if (t != null) setInputKind((k) => inputKindFromPointerType(t, k))
  }
  const onUnmute = () => {
    const a = unmuteAction(state.muted, state.volume)
    if (a === "volume") actions.setVolume(1)
    else if (a === "unmute") actions.toggleMute()
    bump()
  }

  const showBar = computeShowBar({ overlay, paused: state.paused, active, pointerOnBar, menuOpen, keyboardFocus: kbFocus, dismissed })
  useEffect(() => {
    showBarRef.current = showBar
    touchModeRef.current = touchMode
  })
  const hideCursor = inFullscreen && !showBar && !state.paused
  const progress = state.duration > 0 ? clamp(state.currentTime / state.duration, 0, 1) : 0
  const vars = {
    ...playerCssVars(),
    ...(compact ? { "--player-bar-inset": `${PLAYER_COMPACT_INSET_PX}px` } : {}),
  }

  const paint = barPaint({ overlay, fullscreen: inFullscreen, visible: showBar, fx })
  const bar = touchMode ? (
    <PlayerTouchControls
      barRef={barRef}
      state={state}
      actions={actions}
      visible={showBar}
      fade={paint.fade}
      title={titleOverlay}
      showFullscreen={allowFullscreen}
      isFullscreen={isFullscreen}
      showUnmute={showUnmuteButton(touchMode, state.muted, state.volume)}
      onUnmute={onUnmute}
      onMenuOpenChange={setMenuOpen}
      menuContainer={frameEl}
      onFocus={() => setKbFocus(!pointerFocusRef.current)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKbFocus(false)
      }}
    />
  ) : (
    <div
      ref={barRef}
      data-slot="player-bar"
      data-visible={showBar}
      className={
        overlay
          ? `absolute inset-x-(--player-bar-inset) bottom-(--player-bar-inset) z-20 rounded-(--player-bar-radius) p-(--player-bar-padding) ${paint.fade ? "transition-opacity duration-(--player-fade) motion-reduce:transition-none" : ""} ${showBar ? "opacity-100" : "pointer-events-none opacity-0"}`
          : "relative z-20 w-full rounded-(--player-bar-radius) p-(--player-bar-padding)"
      }
      style={paint.style}
      onFocus={() => setKbFocus(!pointerFocusRef.current)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKbFocus(false)
      }}
    >
      <PlayerControls
        variant={variant}
        state={state}
        actions={actions}
        showSettings={!compact}
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
      {skip && (
        <div
          role="status"
          data-slot="player-skip"
          className={`pointer-events-none absolute inset-y-0 z-30 flex w-1/3 items-center justify-center ${skip.zone === "left" ? "left-0" : "right-0"}`}
        >
          <div className="flex flex-col items-center gap-0.5 rounded-full bg-(--player-scrim)/70 px-4 py-2 text-sm font-semibold text-(--player-fg) tabular-nums">
            {skip.zone === "left" ? <ChevronsLeft className="size-5" aria-hidden /> : <ChevronsRight className="size-5" aria-hidden />}
            {formatSkip(skip.total)}
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

  const debugReadout = debugMode !== "off" && (
    <PlayerDebug
      mode={debugMode}
      values={{ paused: state.paused, active, pointerOnBar, menuOpen, kbFocus, isFullscreen, inFullscreen, showBar, waiting: state.waiting, touch: touchMode, dismissed }}
      showBar={showBar}
      barRef={barRef}
      mediaRef={mediaRef}
      moves={moves}
      fx={fx}
    />
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
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (touchCapable && isTouchPointer(e.pointerType)) return // a finger dragging (the seek bar, a scroll) is not hover
      if (touchCapable) setInputKind((k) => inputKindFromPointerType(e.pointerType, k))
      if (debugMode !== "off") {
        moves.current.frame++
        moves.current.last = Date.now()
      }
      onPointerActivity(e)
    },
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (touchCapable) {
        // Switching the layout remounts the controls, so a press on a control (a seek drag that starts on the other
        // layout's bar) switches only once the gesture ends; a press on the video switches right away.
        const onSurface = !!(e.target as HTMLElement).closest?.("[data-slot=player-surface]")
        if (onSurface) setInputKind((k) => inputKindFromPointerType(e.pointerType, k))
        else deferredKind.current = e.pointerType
      }
      if (touchCapable && isTouchPointer(e.pointerType)) {
        lastTouchAt.current = Date.now()
        setPointerOnBar(false)
        // On the video surface the tap machine decides; a press on a control (center button, bar, cog menu) only
        // keeps the controls up and drops a pending surface tap so it can't hide them right after.
        if ((e.target as HTMLElement).closest?.("[data-slot=player-surface]")) return
        clearTimeout(tapTimer.current)
        tapState.current = INITIAL_TAP_STATE
        bump()
        return
      }
      onPointerActivity(e)
    },
    onPointerUp: () => applyDeferredKind(),
    onPointerCancel: () => applyDeferredKind(),
    // Capture on the frame (not the bar) so a press in the speed menu, which is portaled into the frame, counts too.
    onPointerDownCapture: () => (pointerFocusRef.current = true),
    onKeyDownCapture: () => (pointerFocusRef.current = false),
    onPointerEnter: () => (hoveredRef.current = true),
    onPointerLeave: () => {
      hoveredRef.current = false
      setPointerOnBar(false)
    },
    // A touch tap focuses the frame too; that must not show the controls before the tap machine decided.
    onFocus: () => {
      if (touchCapable && Date.now() - lastTouchAt.current < TOUCH_GHOST_MS) return
      bump()
    },
  }
  const frameBase = `${fx.has("videolayer") ? "player-fx-videolayer " : ""}player-skin relative isolate select-none text-(--player-fg) outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`

  if (overlay) {
    return (
      <div {...frameProps} className={`${frameBase} overflow-hidden bg-black ${hideCursor ? "cursor-none" : ""} ${className}`}>
        {children}
        <div
          className="absolute inset-0 z-0 touch-manipulation"
          aria-hidden
          data-slot="player-surface"
          onClick={onSurfaceClick}
          onDoubleClick={onSurfaceDoubleClick}
          onPointerDown={onSurfacePointerDown}
          onPointerUp={onSurfacePointerUp}
          onPointerCancel={onSurfacePointerCancel}
        />
        {overlays}
        {debugReadout}
        {titleOverlay && !touchMode && (
          <p
            data-slot="player-title"
            data-visible={showBar}
            className={`pointer-events-none absolute left-0 top-0 z-10 max-w-full truncate px-3 pb-4 pt-2 text-xs font-medium text-(--player-fg) ${paint.fade ? "transition-opacity duration-(--player-fade) motion-reduce:transition-none" : ""} ${showBar ? "opacity-100" : "opacity-0"}`}
            style={{ background: "linear-gradient(to bottom, color-mix(in oklab, var(--player-scrim) 80%, transparent), transparent)" }}
          >
            {titleOverlay}
          </p>
        )}
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
      <div className="shrink-0 overflow-hidden rounded bg-neutral-800" style={{ width: coverPx, height: coverPx }}>
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

// Fullscreen capability of the frame, falling back to the <video>'s native fullscreen (iPhone Safari).
function detectFullscreenMode(media: HTMLMediaElement | null): FullscreenMode {
  if (typeof document === "undefined") return "frame"
  return fullscreenMode({
    fullscreenEnabled: document.fullscreenEnabled as boolean | undefined,
    canRequest: typeof Element !== "undefined" && typeof Element.prototype.requestFullscreen === "function",
    canWebkitEnter:
      typeof HTMLVideoElement !== "undefined" &&
      media instanceof HTMLVideoElement &&
      typeof (media as HTMLVideoElement & { webkitEnterFullscreen?: unknown }).webkitEnterFullscreen === "function",
  })
}

function Placeholder({ small = false }: { small?: boolean }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-(--player-fg)">
      <Music className={small ? "size-4 opacity-30" : "size-16 opacity-30"} aria-hidden />
    </div>
  )
}
