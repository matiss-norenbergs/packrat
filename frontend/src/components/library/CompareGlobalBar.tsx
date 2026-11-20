import type { CSSProperties } from "react"
import { Maximize, Minimize } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PLAYER_BTN, PlayButton, SpeedMenu, TimeDisplay, VolumeControl } from "@/components/player/PlayerParts"
import { SeekBar } from "@/components/player/SeekBar"
import { PLAYER_ICON_PX, playerCssVars } from "@/components/player/playerTheme"

export interface CompareGlobalBarProps {
  anyPlaying: boolean
  /** Play all is blocked (Wait for ready, not everything buffered yet). Pausing is never blocked. */
  playBlocked: boolean
  readyCount: number
  total: number
  onTogglePlay: () => void
  currentTime: number
  duration: number
  onSeek: (seconds: number) => void
  volume: number
  muted: boolean
  onVolume: (v: number) => void
  onToggleMute: () => void
  rate: number
  onRate: (r: number) => void
  /** Portal target of the speed menu: the page container, which is what goes fullscreen. */
  menuContainer: HTMLElement | null
  preload: boolean
  onPreload: (v: boolean) => void
  waitForReady: boolean
  onWaitForReady: (v: boolean) => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  osd: { id: number; text: string } | null
}

// The docked "global player" under the compare grid: the same control pieces as the cells' skin
// (components/player/PlayerParts + SeekBar), in the themed color scope (.player-themed) because the bar sits
// on the page background, not over a video. Every control acts on all cells at once.
export function CompareGlobalBar(p: CompareGlobalBarProps) {
  const blocked = !p.anyPlaying && p.playBlocked
  const playTip = blocked ? `Buffering… (${p.readyCount}/${p.total} ready)` : p.anyPlaying ? "Pause all" : "Play all"
  return (
    <div
      data-slot="compare-global-bar"
      className="player-themed relative flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t bg-background px-3 py-2 text-foreground"
      style={playerCssVars() as CSSProperties}
    >
      {p.osd && (
        <div
          key={p.osd.id}
          role="status"
          data-slot="compare-osd"
          className="pointer-events-none absolute inset-y-0 left-1/2 z-10 my-auto h-fit -translate-x-1/2 rounded-lg bg-(--player-scrim) px-3 py-1.5 text-sm font-medium text-(--player-fg) tabular-nums shadow-md ring-1 ring-border"
        >
          {p.osd.text}
        </div>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <PlayButton paused={!p.anyPlaying} onClick={p.onTogglePlay} playLabel="Play all" pauseLabel="Pause all" disabled={blocked} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{playTip}</TooltipContent>
      </Tooltip>

      <div className="flex min-w-48 flex-1 items-center gap-1">
        <SeekBar currentTime={p.currentTime} duration={p.duration} buffered={null} onSeek={p.onSeek} className="flex-1" />
        <TimeDisplay currentTime={p.currentTime} duration={p.duration} />
      </div>

      <VolumeControl volume={p.volume} muted={p.muted} onVolume={p.onVolume} onToggleMute={p.onToggleMute} />
      <SpeedMenu rate={p.rate} onRate={p.onRate} container={p.menuContainer} />

      {/* Two stacked toggles so they stay compact in the single-row bar. scale-90 shrinks each switch as a whole
          (track + thumb together). */}
      <div className="flex flex-col justify-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex items-center gap-1 text-[11px] leading-none text-muted-foreground">
              <Switch checked={p.preload} onCheckedChange={p.onPreload} className="scale-90" />
              Preload
            </label>
          </TooltipTrigger>
          <TooltipContent>Buffer every file aggressively as soon as the page opens, not just once you hit play</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex items-center gap-1 text-[11px] leading-none text-muted-foreground">
              <Switch checked={p.waitForReady} onCheckedChange={p.onWaitForReady} className="scale-90" />
              Wait for ready
            </label>
          </TooltipTrigger>
          <TooltipContent>Disable "Play all" until every file has buffered enough to play without stalling</TooltipContent>
        </Tooltip>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={PLAYER_BTN} aria-label={p.isFullscreen ? "Exit full screen" : "Full screen"} onClick={p.onToggleFullscreen}>
            {p.isFullscreen ? <Minimize width={PLAYER_ICON_PX} height={PLAYER_ICON_PX} aria-hidden /> : <Maximize width={PLAYER_ICON_PX} height={PLAYER_ICON_PX} aria-hidden />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{p.isFullscreen ? "Exit full screen" : "Full screen"}</TooltipContent>
      </Tooltip>
    </div>
  )
}
