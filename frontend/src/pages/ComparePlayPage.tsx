import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ArrowLeft, Maximize, Minimize, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ComparePlayerCell } from "@/components/library/ComparePlayerCell"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { useLibrary } from "@/hooks/useLibrary"
import type { LibraryItem } from "@/types/api"

// Zoom-style gallery sizing — as square a grid as possible (columns first,
// so a lone leftover item lands on its own row rather than stretching
// unevenly wide) so each cell claims the most area the viewport allows for
// the given count. 1→1×1, 2→2×1, 3/4→2×2, 5/6→3×2.
function gridDims(n: number) {
  if (n <= 0) return { cols: 1, rows: 1 }
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  return { cols, rows }
}

const PRELOAD_STORAGE_KEY = "packrat:compare-preload"
const WAIT_FOR_READY_STORAGE_KEY = "packrat:compare-wait-for-ready"

// Both default on — for local files there's no real bandwidth cost to
// buffering everything up front, and the whole point of this page is
// comparing playback, so starting before every candidate can actually play
// through smoothly works against the reason you're here.
function readBoolSetting(key: string): boolean {
  const raw = localStorage.getItem(key)
  return raw === null ? true : raw === "true"
}

// Plays up to 6 items at once, each with its own independent seek bar
// (native controls, per ComparePlayerCell) — the bottom bar just reaches
// into every currently-mounted element to trigger a batched play/pause/
// volume change; each cell's own controls still work independently
// afterward, since this never touches anything beyond those three
// properties.
export function ComparePlayPage() {
  const [searchParams] = useSearchParams()
  const { data: allItems, isLoading } = useLibrary()
  const mediaRefs = useRef<Map<number, HTMLMediaElement>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const [preload, setPreload] = useState(() => readBoolSetting(PRELOAD_STORAGE_KEY))
  const [waitForReady, setWaitForReady] = useState(() => readBoolSetting(WAIT_FOR_READY_STORAGE_KEY))
  useEffect(() => localStorage.setItem(PRELOAD_STORAGE_KEY, String(preload)), [preload])
  useEffect(() => localStorage.setItem(WAIT_FOR_READY_STORAGE_KEY, String(waitForReady)), [waitForReady])

  // Which item ids have buffered enough to play through without stalling
  // (or are locked/private, which count as trivially ready — see
  // ComparePlayerCell). Only consulted when waitForReady is on; "Play all"
  // ignores it entirely otherwise, matching the old always-fire behavior.
  const [readyIds, setReadyIds] = useState<Set<number>>(new Set())
  const setItemReady = (id: number) => (ready: boolean) => {
    setReadyIds((prev) => {
      if (ready === prev.has(id)) return prev
      const next = new Set(prev)
      if (ready) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Tracks the Fullscreen API's actual state (not just our own toggle
  // intent) — Escape, F11, or the browser's own UI can exit fullscreen
  // without going through our button, and the icon needs to follow that.
  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange)
  }, [])

  const toggleFullscreen = () => {
    // Some embedding contexts (e.g. an iframe without the fullscreen
    // permission) reject this outright — swallow it rather than surface an
    // unhandled promise rejection; the button just won't visibly do
    // anything there, same as it would on a page that never wired it up.
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else containerRef.current?.requestFullscreen().catch(() => {})
  }

  const ids = useMemo(
    () =>
      (searchParams.get("items") ?? "")
        .split(",")
        .map((s) => Number(s))
        .filter((n) => !Number.isNaN(n)),
    [searchParams],
  )

  // Ghost items have no file to play — filtered out here rather than
  // trusted from the URL, since a ghost could still be sitting in a
  // persisted compare list (added before its file was deleted) even though
  // CompareListPage no longer lets one be selected.
  const items = useMemo(() => {
    if (!allItems) return []
    const byId = new Map(allItems.map((i) => [i.id, i]))
    return ids.map((id) => byId.get(id)).filter((i): i is LibraryItem => i != null && i.status !== "ghost")
  }, [allItems, ids])

  const registerMedia = (id: number) => (el: HTMLMediaElement | null) => {
    if (el) mediaRefs.current.set(id, el)
    else mediaRefs.current.delete(id)
  }

  const allReady = items.length > 0 && items.every((item) => readyIds.has(item.id))
  const readyCount = items.filter((item) => readyIds.has(item.id)).length
  const playBlocked = waitForReady && !allReady

  // Tracks this button's own last command, not each cell's actual playing
  // state — a per-cell native control can still pause/play independently
  // afterward (see the component doc comment above), same looseness the
  // separate Play/Pause buttons this replaced already had.
  const [isPlaying, setIsPlaying] = useState(false)

  const togglePlayAll = () => {
    if (isPlaying) {
      for (const el of mediaRefs.current.values()) el.pause()
      setIsPlaying(false)
      return
    }
    if (playBlocked) return
    for (const el of mediaRefs.current.values()) el.play()
    setIsPlaying(true)
  }
  const setAllVolume = (volume: number) => {
    for (const el of mediaRefs.current.values()) el.volume = volume
  }

  if (isLoading) return null

  const { cols, rows } = gridDims(items.length)

  return (
    <RevealAllProvider>
      <div ref={containerRef} className="flex h-screen w-screen flex-col overflow-hidden bg-black">
        <div className="flex shrink-0 items-center gap-2 bg-background px-2 py-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm">
                <Link to="/compare-list">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to compare list</TooltipContent>
          </Tooltip>
          <h1 className="text-sm font-medium">Comparing {items.length} files</h1>
        </div>

        {items.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Nothing to play — the link may be missing item ids, or those files are no longer in the compare list.
          </p>
        ) : (
          <div
            className="grid min-h-0 flex-1"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
          >
            {items.map((item) => (
              <ComparePlayerCell
                key={item.id}
                item={item}
                registerMedia={registerMedia(item.id)}
                preload={preload}
                onReadyChange={setItemReady(item.id)}
              />
            ))}
          </div>
        )}

        {/* A bottom "player bar" — imitates a single global player, mirroring
            where a native player's own controls would sit. */}
        <div className="flex shrink-0 items-center gap-2 border-t bg-background px-3 py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                onClick={togglePlayAll}
                disabled={!isPlaying && playBlocked}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {!isPlaying && playBlocked
                ? `Buffering… (${readyCount}/${items.length} ready)`
                : isPlaying
                  ? "Pause all"
                  : "Play all"}
            </TooltipContent>
          </Tooltip>

          {/* Stacked two-row block so both toggles fit compactly, but the
              block itself is still just one item in this single-row bar
              (items-center keeps it vertically centered against the
              buttons on either side). scale-90 shrinks the switch as a
              whole (track+thumb together, so the thumb still fills the
              track correctly) rather than fighting its own dimensions. */}
          <div className="ml-3 flex flex-col justify-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex items-center gap-1 text-[11px] leading-none text-muted-foreground">
                  <Switch checked={preload} onCheckedChange={setPreload} className="scale-90" />
                  Preload
                </label>
              </TooltipTrigger>
              <TooltipContent>Buffer every file aggressively as soon as the page opens, not just once you hit play</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex items-center gap-1 text-[11px] leading-none text-muted-foreground">
                  <Switch checked={waitForReady} onCheckedChange={setWaitForReady} className="scale-90" />
                  Wait for ready
                </label>
              </TooltipTrigger>
              <TooltipContent>Disable "Play all" until every file has buffered enough to play without stalling</TooltipContent>
            </Tooltip>
          </div>

          <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            Volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              defaultValue={1}
              onChange={(e) => setAllVolume(Number(e.target.value))}
              className="w-32"
            />
          </label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="secondary" size="icon-sm" onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isFullscreen ? "Exit full screen" : "Full screen"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </RevealAllProvider>
  )
}
