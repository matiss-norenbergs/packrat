import { Maximize, Minimize } from "lucide-react"
import { PLAYER_BTN, PlayButton, SettingsMenu, TimeDisplay, VolumeControl } from "./PlayerParts"
import { PLAYER_ICON_PX } from "./playerTheme"
import { SeekBar } from "./SeekBar"
import type { MediaState } from "./useMediaState"

export interface PlayerActions {
  togglePlay: () => void
  seek: (seconds: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  setRate: (r: number) => void
  toggleFullscreen: () => void
}

// The control bar of one element. `full` = two rows (seek bar above the buttons, settings cog and fullscreen on the
// right); `compact` = one row (play, seek, time, volume) for the mini player and the compare cells. The pieces
// themselves live in PlayerParts.tsx and are shared with the compare page's global bar.
export function PlayerControls({
  variant,
  state,
  actions,
  showSettings,
  showFullscreen,
  isFullscreen,
  onMenuOpenChange,
  menuContainer,
}: {
  variant: "full" | "compact"
  state: MediaState
  actions: PlayerActions
  showSettings: boolean
  showFullscreen: boolean
  /** This frame itself is the fullscreen element (the fullscreen button's icon). */
  isFullscreen: boolean
  onMenuOpenChange: (open: boolean) => void
  menuContainer: HTMLElement | null
}) {
  const seek = (
    <SeekBar currentTime={state.currentTime} duration={state.duration} buffered={state.buffered} onSeek={actions.seek} className="flex-1" />
  )
  const play = <PlayButton paused={state.paused} onClick={actions.togglePlay} />
  const volume = <VolumeControl volume={state.volume} muted={state.muted} onVolume={actions.setVolume} onToggleMute={actions.toggleMute} />
  if (variant === "compact") {
    // A container-query wrapper: in a narrow cell the time and then the volume drop out instead of overflowing.
    return (
      <div className="@container">
        <div className="flex items-center gap-1" data-slot="player-controls">
          {play}
          {seek}
          <TimeDisplay currentTime={state.currentTime} duration={state.duration} className="@max-[15rem]:hidden" />
          <VolumeControl
            volume={state.volume}
            muted={state.muted}
            onVolume={actions.setVolume}
            onToggleMute={actions.toggleMute}
            className="@max-[10rem]:hidden"
          />
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-0.5" data-slot="player-controls">
      <div className="flex px-1">{seek}</div>
      <div className="flex items-center gap-1">
        {play}
        {volume}
        <TimeDisplay currentTime={state.currentTime} duration={state.duration} />
        <div className="ms-auto flex items-center gap-1">
          {showSettings && <SettingsMenu rate={state.rate} onRate={actions.setRate} onOpenChange={onMenuOpenChange} container={menuContainer} />}
          {showFullscreen && (
            <button type="button" className={PLAYER_BTN} aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={actions.toggleFullscreen}>
              {isFullscreen ? (
                <Minimize width={PLAYER_ICON_PX} height={PLAYER_ICON_PX} aria-hidden />
              ) : (
                <Maximize width={PLAYER_ICON_PX} height={PLAYER_ICON_PX} aria-hidden />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
