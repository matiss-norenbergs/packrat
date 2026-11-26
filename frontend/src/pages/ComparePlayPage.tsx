import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button"
import { CompareGlobalBar } from "@/components/library/CompareGlobalBar"
import { ComparePlayerCell } from "@/components/library/ComparePlayerCell"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { useCompareGroup } from "@/components/library/useCompareGroup"
import { DEFAULT_SYNC_MODE, parseSyncMode, type SyncMode } from "@/components/player/groupMedia"
import { describeKeyTarget, isTypingTarget, resolveGlobalKey } from "@/components/player/playerKeys"
import { useLibraryItemsByIds } from "@/hooks/useLibrary"
import { readStorage, writeStorage } from "@/lib/safeStorage"

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
  const raw = readStorage(key)
  return raw === null ? true : raw === "true"
}

// Sync mode of the global seek bar ("time" | "percent"): a client-only preference; missing, invalid or an
// unavailable storage all fall back to "time".
const SYNC_MODE_STORAGE_KEY = "packrat:compare-sync-mode"
function readSyncMode(): SyncMode {
  try {
    return parseSyncMode(readStorage(SYNC_MODE_STORAGE_KEY))
  } catch {
    return DEFAULT_SYNC_MODE
  }
}
function writeSyncMode(mode: SyncMode) {
  writeStorage(SYNC_MODE_STORAGE_KEY, mode)
}

// Plays up to 6 items at once. Each cell has its own skin (independent controls, ComparePlayerCell); the docked
// global bar (CompareGlobalBar) drives all cells through useCompareGroup: play/pause, one seek bar, master volume
// and speed. Keyboard: a focused cell handles the shortcuts for itself alone (its skin, shortcuts="focus"); with no
// cell focused the same keys act on all cells (resolveGlobalKey, registered on the document below).
export function ComparePlayPage() {
  const [searchParams] = useSearchParams()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null) // portal target for the speed menu
  const setContainer = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    setContainerEl(node)
  }, [])
  const [isFullscreen, setIsFullscreen] = useState(false)

  const [preload, setPreload] = useState(() => readBoolSetting(PRELOAD_STORAGE_KEY))
  const [waitForReady, setWaitForReady] = useState(() => readBoolSetting(WAIT_FOR_READY_STORAGE_KEY))
  useEffect(() => writeStorage(PRELOAD_STORAGE_KEY, String(preload)), [preload])
  useEffect(() => writeStorage(WAIT_FOR_READY_STORAGE_KEY, String(waitForReady)), [waitForReady])

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
  const { items: fetchedItems, isLoading } = useLibraryItemsByIds(ids)
  const items = useMemo(() => fetchedItems.filter((i) => i.status !== "ghost"), [fetchedItems])

  const itemIds = useMemo(() => items.map((i) => i.id), [items])
  const [syncMode, setSyncModeState] = useState<SyncMode>(readSyncMode)
  const setSyncMode = (mode: SyncMode) => {
    setSyncModeState(mode)
    writeSyncMode(mode)
  }
  const group = useCompareGroup(itemIds, syncMode)

  const allReady = items.length > 0 && items.every((item) => readyIds.has(item.id))
  const readyCount = items.filter((item) => readyIds.has(item.id)).length
  const playBlocked = waitForReady && !allReady
  const { anyPlaying } = group.summary

  // The button label follows the cells' real state: "Pause all" while any cell is playing. Wait for ready blocks
  // starting (never pausing), for the button and the shortcut alike.
  const togglePlayAll = () => {
    if (anyPlaying) return group.pauseAll()
    if (playBlocked) return group.showOsd(`Buffering… (${readyCount}/${items.length} ready)`)
    group.playAll()
  }

  // Global keyboard scope: acts only when no cell has focus (resolveGlobalKey decides); the handler is
  // registered once and reads the latest closures through a ref.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  const onKey = (e: KeyboardEvent) => {
    const cmd = resolveGlobalKey({
      key: e.key,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      defaultPrevented: e.defaultPrevented,
      typing: isTypingTarget(e.target),
      inCell: e.target instanceof Element && !!e.target.closest("[data-slot=player]"),
      target: describeKeyTarget(e.target),
    })
    if (!cmd) return
    e.preventDefault()
    if (cmd.type === "toggle") togglePlayAll()
    else if (cmd.type === "fullscreen") toggleFullscreen()
    else group.run(cmd)
  }
  useEffect(() => {
    keyRef.current = onKey
  })
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keyRef.current(e)
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  if (isLoading) return null

  const { cols, rows } = gridDims(items.length)

  return (
    <RevealAllProvider>
      {/* tabIndex -1: a click on the empty page or the global bar focuses the container, which takes focus out of
          any cell so the global keyboard scope applies. */}
      <div ref={setContainer} tabIndex={-1} className="flex h-dvh w-screen flex-col overflow-hidden bg-black outline-none">
        <div className="flex shrink-0 items-center gap-2 bg-background px-2 py-1.5">
          <TooltipIconButton label="Back to compare list" asChild variant="ghost" size="icon-sm">
            <Link to="/compare-list">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </TooltipIconButton>
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
                registerMedia={group.registerMedia(item.id)}
                preload={preload}
                onReadyChange={setItemReady(item.id)}
              />
            ))}
          </div>
        )}

        <CompareGlobalBar
          anyPlaying={anyPlaying}
          playBlocked={playBlocked}
          readyCount={readyCount}
          total={items.length}
          onTogglePlay={togglePlayAll}
          currentTime={group.seekScale.value}
          duration={group.seekScale.max}
          onSeek={group.seekAll}
          syncMode={syncMode}
          onSyncMode={setSyncMode}
          volume={group.volume}
          muted={group.muted}
          onVolume={group.setVolumeAll}
          onToggleMute={group.toggleMuteAll}
          rate={group.rate}
          onRate={group.setRateAll}
          menuContainer={containerEl}
          preload={preload}
          onPreload={setPreload}
          waitForReady={waitForReady}
          onWaitForReady={setWaitForReady}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          osd={group.osd}
        />
      </div>
    </RevealAllProvider>
  )
}
