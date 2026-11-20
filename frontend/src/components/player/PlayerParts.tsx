import { Pause, Play, Volume1, Volume2, VolumeX } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatSpeed, formatTime } from "./playerMath"
import { PLAYER_ICON_PX, PLAYER_SPEEDS } from "./playerTheme"

// The player's control pieces as plain, presentational components (value in, callback out): the skin
// (PlayerControls, driven by one element's MediaState) and the compare page's global bar (driven by the whole
// group) render these same pieces. They only use the --player-* variables, so they work in either color scope:
// light-on-dark over a video (.player-skin) or themed on the page (.player-themed), see globals.css.

export const PLAYER_BTN =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-(--player-fg) outline-none transition-colors hover:bg-(--player-hover-bg) focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"

export function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  const props = { width: PLAYER_ICON_PX, height: PLAYER_ICON_PX, "aria-hidden": true }
  if (muted || volume === 0) return <VolumeX {...props} />
  return volume < 0.5 ? <Volume1 {...props} /> : <Volume2 {...props} />
}

export function PlayButton({
  paused,
  onClick,
  playLabel = "Play",
  pauseLabel = "Pause",
  disabled = false,
}: {
  paused: boolean
  onClick: () => void
  playLabel?: string
  pauseLabel?: string
  /** Blocks the click but keeps the button focusable and hoverable (so its tooltip still shows). */
  disabled?: boolean
}) {
  const Icon = paused ? Play : Pause
  return (
    <button
      type="button"
      className={`${PLAYER_BTN} ${disabled ? "opacity-50" : ""}`}
      aria-label={paused ? playLabel : pauseLabel}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
    >
      <Icon width={PLAYER_ICON_PX} height={PLAYER_ICON_PX} aria-hidden fill="currentColor" />
    </button>
  )
}

export function VolumeControl({
  volume,
  muted,
  onVolume,
  onToggleMute,
  className = "",
}: {
  volume: number
  muted: boolean
  onVolume: (v: number) => void
  onToggleMute: () => void
  className?: string
}) {
  const shown = muted ? 0 : volume
  return (
    <div className={`group/vol flex shrink-0 items-center ${className}`} data-slot="player-volume">
      <button type="button" className={PLAYER_BTN} aria-label={muted || volume === 0 ? "Unmute" : "Mute"} onClick={onToggleMute}>
        <VolumeIcon volume={volume} muted={muted} />
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
          onChange={(e) => onVolume(Number(e.target.value))}
        />
      </div>
    </div>
  )
}

export function TimeDisplay({
  currentTime,
  duration,
  className = "",
  text,
}: {
  currentTime: number
  duration: number
  className?: string
  /** Replaces the "current / duration" pair (the compare bar's percent readout). */
  text?: string
}) {
  return (
    <span className={`shrink-0 px-1 text-xs font-medium text-(--player-fg) tabular-nums ${className}`} data-slot="player-time">
      {text ?? `${formatTime(currentTime)} / ${formatTime(duration)}`}
    </span>
  )
}

export function SpeedMenu({
  rate,
  onRate,
  onOpenChange,
  container,
}: {
  rate: number
  onRate: (r: number) => void
  onOpenChange?: (open: boolean) => void
  /** Portal target: the fullscreen element, so the menu stays visible in fullscreen. */
  container: HTMLElement | null
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Playback speed, ${formatSpeed(rate)}`} className={`${PLAYER_BTN} w-auto min-w-10 px-2 text-xs font-semibold tabular-nums`}>
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
