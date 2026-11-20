import { Maximize, Minimize, Pause, Play, Volume1, Volume2, VolumeX } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatSpeed, formatTime } from "./playerMath"
import { PLAYER_ICON_PX, PLAYER_SPEEDS } from "./playerTheme"
import { SeekBar } from "./SeekBar"
import type { MediaState } from "./useMediaState"

const BTN =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-(--player-fg) outline-none transition-colors hover:bg-(--player-hover-bg) focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"

export interface PlayerActions {
  togglePlay: () => void
  seek: (seconds: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  setRate: (r: number) => void
  toggleFullscreen: () => void
}

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  const props = { width: PLAYER_ICON_PX, height: PLAYER_ICON_PX, "aria-hidden": true }
  if (muted || volume === 0) return <VolumeX {...props} />
  return volume < 0.5 ? <Volume1 {...props} /> : <Volume2 {...props} />
}

function PlayButton({ state, actions }: { state: MediaState; actions: PlayerActions }) {
  const Icon = state.paused ? Play : Pause
  return (
    <button type="button" className={BTN} aria-label={state.paused ? "Play" : "Pause"} onClick={actions.togglePlay}>
      <Icon width={PLAYER_ICON_PX} height={PLAYER_ICON_PX} aria-hidden fill="currentColor" />
    </button>
  )
}

function Volume({ state, actions }: { state: MediaState; actions: PlayerActions }) {
  const shown = state.muted ? 0 : state.volume
  return (
    <div className="group/vol flex shrink-0 items-center" data-slot="player-volume">
      <button
        type="button"
        className={BTN}
        aria-label={state.muted || state.volume === 0 ? "Unmute" : "Mute"}
        onClick={actions.toggleMute}
      >
        <VolumeIcon volume={state.volume} muted={state.muted} />
      </button>
      <div className="flex w-0 items-center overflow-hidden transition-[width] duration-150 group-focus-within/vol:w-(--player-volume-slider) group-hover/vol:w-(--player-volume-slider) motion-reduce:transition-none">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={shown}
          aria-label="Volume"
          aria-valuetext={`${Math.round(shown * 100)} percent`}
          className="player-range mx-1 w-[calc(var(--player-volume-slider)-0.5rem)]"
          style={{ ["--fill" as string]: `${shown * 100}%` }}
          onChange={(e) => actions.setVolume(Number(e.target.value))}
        />
      </div>
    </div>
  )
}

function Time({ state }: { state: MediaState }) {
  return (
    <span className="shrink-0 px-1 text-xs font-medium text-(--player-fg) tabular-nums" data-slot="player-time">
      {formatTime(state.currentTime)} / {formatTime(state.duration)}
    </span>
  )
}

function SpeedMenu({
  rate,
  onRate,
  onOpenChange,
  container,
}: {
  rate: number
  onRate: (r: number) => void
  onOpenChange: (open: boolean) => void
  container: HTMLElement | null
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Playback speed, ${formatSpeed(rate)}`}
          className={`${BTN} w-auto min-w-10 px-2 text-xs font-semibold tabular-nums`}
        >
          {formatSpeed(rate)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" container={container} className="w-28 min-w-0">
        <DropdownMenuRadioGroup value={String(rate)} onValueChange={(v) => onRate(Number(v))}>
          {PLAYER_SPEEDS.map((s) => (
            <DropdownMenuRadioItem key={s} value={String(s)}>
              {formatSpeed(s)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The control bar. `full` = two rows (seek bar above the buttons, speed pill and fullscreen on the
// right); `compact` = one row (play, seek, time, volume) for the mini player.
export function PlayerControls({
  variant,
  state,
  actions,
  showSpeed,
  showFullscreen,
  isFullscreen,
  onMenuOpenChange,
  menuContainer,
}: {
  variant: "full" | "compact"
  state: MediaState
  actions: PlayerActions
  showSpeed: boolean
  showFullscreen: boolean
  isFullscreen: boolean
  onMenuOpenChange: (open: boolean) => void
  menuContainer: HTMLElement | null
}) {
  const seek = (
    <SeekBar currentTime={state.currentTime} duration={state.duration} buffered={state.buffered} onSeek={actions.seek} className="flex-1" />
  )
  if (variant === "compact") {
    return (
      <div className="flex items-center gap-1" data-slot="player-controls">
        <PlayButton state={state} actions={actions} />
        {seek}
        <Time state={state} />
        <Volume state={state} actions={actions} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-0.5" data-slot="player-controls">
      <div className="flex px-1">{seek}</div>
      <div className="flex items-center gap-1">
        <PlayButton state={state} actions={actions} />
        <Volume state={state} actions={actions} />
        <Time state={state} />
        <div className="ms-auto flex items-center gap-1">
          {showSpeed && <SpeedMenu rate={state.rate} onRate={actions.setRate} onOpenChange={onMenuOpenChange} container={menuContainer} />}
          {showFullscreen && (
            <button
              type="button"
              className={BTN}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={actions.toggleFullscreen}
            >
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
