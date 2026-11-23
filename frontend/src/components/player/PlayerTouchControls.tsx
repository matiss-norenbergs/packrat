import type { CSSProperties, FocusEvent, RefObject } from "react"
import { Maximize, Minimize, Pause, Play, VolumeX } from "lucide-react"
import type { PlayerActions } from "./PlayerControls"
import { SettingsMenu, TimeDisplay } from "./PlayerParts"
import { PLAYER_ICON_PX, PLAYER_TOUCH_SCRIM_EDGE_OPACITY, PLAYER_TOUCH_SCRIM_OPACITY } from "./playerTheme"
import { SeekBar } from "./SeekBar"
import type { MediaState } from "./useMediaState"

// Touch mode's controls (the item page's video on a phone or tablet), modeled on mobile video players: a dim scrim
// over the picture, a big play/pause button in the middle, the title and the settings cog on top, and at the bottom
// a full-width seek bar with time on the left and fullscreen on the right. No play button, volume slider or mute
// button in the bottom row (phones have hardware volume); only an unmute button while muted / at volume 0.
//
// The whole layer is `pointer-events: none` so a tap on the scrim reaches the video surface underneath (which
// toggles these controls); only the controls themselves take taps, and only while shown.

export const PLAYER_TOUCH_BTN =
  "inline-flex size-(--player-touch-target) shrink-0 items-center justify-center rounded-full text-(--player-fg) outline-none transition-colors hover:bg-(--player-hover-bg) focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"

const scrim = (a: number) => `color-mix(in oklab, var(--player-scrim) ${a * 100}%, transparent)`

export function PlayerTouchControls({
  barRef,
  state,
  actions,
  visible,
  fade,
  title,
  showFullscreen,
  isFullscreen,
  showUnmute,
  onUnmute,
  onMenuOpenChange,
  menuContainer,
  onFocus,
  onBlur,
}: {
  barRef: RefObject<HTMLDivElement | null>
  state: MediaState
  actions: PlayerActions
  visible: boolean
  fade: boolean
  title?: string
  showFullscreen: boolean
  isFullscreen: boolean
  showUnmute: boolean
  onUnmute: () => void
  onMenuOpenChange: (open: boolean) => void
  menuContainer: HTMLElement | null
  onFocus: () => void
  onBlur: (e: FocusEvent<HTMLDivElement>) => void
}) {
  const live = visible ? "pointer-events-auto" : ""
  const iconPx = PLAYER_ICON_PX + 4
  const style: CSSProperties = {
    background: `linear-gradient(to bottom, ${scrim(PLAYER_TOUCH_SCRIM_EDGE_OPACITY)}, transparent 28%, transparent 62%, ${scrim(PLAYER_TOUCH_SCRIM_EDGE_OPACITY)}), ${scrim(PLAYER_TOUCH_SCRIM_OPACITY)}`,
    ["--player-seek-hit" as string]: "var(--player-touch-seek-hit)",
  }
  return (
    <div
      ref={barRef}
      data-slot="player-bar"
      data-touch="true"
      data-visible={visible}
      className={`pointer-events-none absolute inset-0 z-20 ${fade ? "transition-opacity duration-(--player-fade) motion-reduce:transition-none" : ""} ${visible ? "opacity-100" : "opacity-0"}`}
      style={style}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="absolute inset-x-0 top-0 flex items-start gap-2 px-2 pt-1">
        <p className="min-w-0 flex-1 truncate px-1 pt-3 text-sm font-medium text-(--player-fg)" data-slot="player-title">
          {title}
        </p>
        <div className={live}>
          <SettingsMenu
            rate={state.rate}
            onRate={actions.setRate}
            onOpenChange={onMenuOpenChange}
            container={menuContainer}
            side="bottom"
            className={PLAYER_TOUCH_BTN}
            iconPx={iconPx}
          />
        </div>
      </div>

      <button
        type="button"
        data-slot="player-center-play"
        aria-label={state.paused ? "Play" : "Pause"}
        className={`absolute inset-0 m-auto flex size-(--player-center-btn) items-center justify-center rounded-full text-(--player-fg) outline-none focus-visible:ring-2 focus-visible:ring-ring ${live}`}
        style={{ background: scrim(0.55) }}
        onClick={actions.togglePlay}
      >
        {state.paused ? <Play className="size-1/2 translate-x-[2px]" fill="currentColor" aria-hidden /> : <Pause className="size-1/2" fill="currentColor" aria-hidden />}
      </button>

      <div className="absolute inset-x-0 bottom-0 px-3 pb-1">
        <div className={`flex ${live}`}>
          <SeekBar currentTime={state.currentTime} duration={state.duration} buffered={state.buffered} onSeek={actions.seek} className="flex-1" alwaysShowHandle />
        </div>
        <div className="-mt-1 flex items-center gap-1">
          <TimeDisplay currentTime={state.currentTime} duration={state.duration} className="text-sm" />
          <div className={`ms-auto flex items-center ${live}`}>
            {showUnmute && (
              <button type="button" className={PLAYER_TOUCH_BTN} aria-label="Unmute" data-slot="player-unmute" onClick={onUnmute}>
                <VolumeX width={iconPx} height={iconPx} aria-hidden />
              </button>
            )}
            {showFullscreen && (
              <button type="button" className={PLAYER_TOUCH_BTN} aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={actions.toggleFullscreen}>
                {isFullscreen ? <Minimize width={iconPx} height={iconPx} aria-hidden /> : <Maximize width={iconPx} height={iconPx} aria-hidden />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
