import type { CSSProperties } from "react"
import { Maximize, Minimize } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PLAYER_BTN, PlayButton, SpeedMenu, TimeDisplay, VolumeControl } from "@/components/player/PlayerParts"
import { SeekBar } from "@/components/player/SeekBar"
import { formatPercent, PERCENT_SCALE, type SyncMode } from "@/components/player/groupMedia"
import { PLAYER_ICON_PX, playerCssVars } from "@/components/player/playerTheme"

export interface CompareGlobalBarProps {
  anyPlaying: boolean
  /** Play all is blocked (Wait for ready, not everything buffered yet). Pausing is never blocked. */
  playBlocked: boolean
  readyCount: number
  total: number
  onTogglePlay: () => void
  /** The seek slider's value and range, in the units of `syncMode`: seconds (time) or 0-100 percent points (percent). */
  currentTime: number
  duration: number
  onSeek: (value: number) => void
  syncMode: SyncMode
  onSyncMode: (mode: SyncMode) => void
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

const SYNC_OPTIONS: readonly { mode: SyncMode; label: string }[] = [
  { mode: "time", label: "Time" },
  { mode: "percent", label: "Percent" },
]

// "Sync: Time | Percent": a two-state segmented control (radio group) for what the global seek bar maps onto the cells.
function SyncModeToggle({ mode, onChange }: { mode: SyncMode; onChange: (mode: SyncMode) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div role="radiogroup" aria-label="Seek sync mode" className="flex shrink-0 items-center gap-1 text-[11px] leading-none text-muted-foreground">
          <span aria-hidden>Sync</span>
          <div className="flex rounded-md bg-(--player-track-bg) p-0.5">
            {SYNC_OPTIONS.map((o) => (
              <button
                key={o.mode}
                type="button"
                role="radio"
                aria-checked={mode === o.mode}
                aria-label={`Sync by ${o.label.toLowerCase()}`}
                onClick={() => onChange(o.mode)}
                className={`rounded-[5px] px-1.5 py-1 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${mode === o.mode ? "bg-background text-foreground shadow-sm" : "text-(--player-fg) hover:bg-(--player-hover-bg)"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>Time: scrubbing puts every file at the same timestamp. Percent: every file goes to the same relative position of its own length.</TooltipContent>
    </Tooltip>
  )
}

// The docked "global player" under the compare grid: the same control pieces as the cells' skin
// (components/player/PlayerParts + SeekBar), in the themed color scope (.player-themed) because the bar sits
// on the page background, not over a video. Every control acts on all cells at once.
export function CompareGlobalBar(p: CompareGlobalBarProps) {
  const percent = p.syncMode === "percent"
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
        <SeekBar
          currentTime={p.currentTime}
          duration={p.duration}
          buffered={null}
          onSeek={p.onSeek}
          formatValue={percent ? (v) => formatPercent(v / PERCENT_SCALE) : undefined}
          className="flex-1"
        />
        <TimeDisplay currentTime={p.currentTime} duration={p.duration} text={percent ? formatPercent(p.currentTime / PERCENT_SCALE) : undefined} />
      </div>

      <SyncModeToggle mode={p.syncMode} onChange={p.onSyncMode} />

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
