import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Maximize2, Music, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { mediaFileUrl } from "@/lib/api"
import { isAudioFilename } from "@/lib/utils"
import { usePersistedVolume } from "@/hooks/usePersistedVolume"
import { syncMediaOnReady } from "@/lib/mediaSeek"
import { useMiniPlayer } from "./MiniPlayerContext"

// The floating bottom-right player that keeps an item playing while the user
// browses elsewhere in /browse. Renders a fresh <video>/<audio> element
// seeked to where playback was minimized, rather than literally reusing the
// item page's DOM node (which would need portal-based reparenting) — for
// local files the reseek is fast enough to feel seamless. Volume is shared
// with the full item page via usePersistedVolume's localStorage sync (only
// one of the two players is ever mounted at a time, so this is enough to
// keep them in sync); play/pause state is carried explicitly through
// MiniPlayerState/navigate state since it isn't persisted anywhere.
export function MiniPlayerDock() {
  const { miniPlayer, close } = useMiniPlayer()
  const navigate = useNavigate()
  // MiniPlayerDock itself never unmounts (see BrowseLayout), so the volume
  // sync effect needs to re-attach every time a new <audio>/<video> element
  // appears — keyed on the item's path, which is unset while minimized.
  const mediaRef = usePersistedVolume<HTMLVideoElement & HTMLAudioElement>(miniPlayer?.item.path)

  // Runs after commit, once the ref is populated — see syncMediaOnReady for
  // why this can't just be the JSX onLoadedMetadata prop. Hoisted above the
  // early return below since hooks can't be called conditionally.
  useEffect(() => {
    const el = mediaRef.current
    if (!el || !miniPlayer) return
    return syncMediaOnReady(el, miniPlayer.startTime, !miniPlayer.paused)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miniPlayer?.item.path])

  if (!miniPlayer) return null
  const { item, startTime, paused } = miniPlayer

  const expand = () => {
    const currentTime = mediaRef.current?.currentTime ?? startTime
    const stillPaused = mediaRef.current?.paused ?? paused
    close()
    navigate(`/browse/${item.id}`, { state: { resumeAt: currentTime, resumePaused: stillPaused } })
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 overflow-hidden rounded-lg border bg-background shadow-2xl">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-2 py-1.5">
        <button
          type="button"
          onClick={expand}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium hover:underline"
          title={item.title}
        >
          {item.title}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon-xs" onClick={expand} title="Expand">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" onClick={close} title="Close">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isAudioFilename(item.filename) ? (
        <div className="space-y-2 p-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-neutral-800">
              {item.thumbnail ? (
                <img src={mediaFileUrl(item.thumbnail)} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Music className="h-4 w-4 text-white/30" />
                </div>
              )}
            </div>
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {item.artistName ?? item.uploader ?? "Unknown artist"}
            </p>
          </div>
          <audio key={item.path} ref={mediaRef} controls className="w-full">
            <source src={mediaFileUrl(item.path)} />
          </audio>
        </div>
      ) : (
        <video key={item.path} ref={mediaRef} controls className="aspect-video w-full bg-black object-contain">
          <source src={mediaFileUrl(item.path)} />
        </video>
      )}
    </div>
  )
}
