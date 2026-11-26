import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Maximize2, X } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button"
import { librarySmallThumbnailUrl, mediaFileUrl } from "@/lib/api"
import { isAudioFilename } from "@/lib/utils"
import { usePersistedVolume } from "@/hooks/usePersistedVolume"
import { syncMediaOnReady } from "@/lib/mediaSeek"
import { PlayerSkin } from "@/components/player/PlayerSkin"
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
  const thumbUrl = librarySmallThumbnailUrl(item)

  const expand = () => {
    const currentTime = mediaRef.current?.currentTime ?? startTime
    const stillPaused = mediaRef.current?.paused ?? paused
    close()
    navigate(`/browse/${item.id}`, { state: { resumeAt: currentTime, resumePaused: stillPaused } })
  }

  return (
    // 16rem on phones (20rem covered nearly the whole width at 390px), 20rem from sm up.
    // BrowseLayout pads the page bottom while this is open so the last row can scroll clear of it.
    <div className="fixed bottom-4 right-4 z-50 w-64 overflow-hidden rounded-lg border bg-background shadow-2xl sm:w-80">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-2 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={expand}
              className="min-w-0 flex-1 truncate text-left text-xs font-medium hover:underline pointer-coarse:min-h-11"
            >
              {item.title}
            </button>
          </TooltipTrigger>
          <TooltipContent>{item.title}</TooltipContent>
        </Tooltip>
        <div className="flex shrink-0 items-center gap-1">
          <TooltipIconButton label="Expand" type="button" variant="ghost" size="icon-xs" className="pointer-coarse:size-11" onClick={expand}>
            <Maximize2 className="h-3.5 w-3.5" />
          </TooltipIconButton>
          <TooltipIconButton label="Close" type="button" variant="ghost" size="icon-xs" className="pointer-coarse:size-11" onClick={close}>
            <X className="h-3.5 w-3.5" />
          </TooltipIconButton>
        </div>
      </div>

      {isAudioFilename(item.filename) ? (
        <PlayerSkin
          key={item.path}
          mediaRef={mediaRef}
          kind="audio"
          variant="compact"
          artist={item.artistName ?? item.uploader ?? "Unknown artist"}
          coverUrl={thumbUrl}
        >
          <audio ref={mediaRef}>
            <source src={mediaFileUrl(item.path)} />
          </audio>
        </PlayerSkin>
      ) : (
        <PlayerSkin key={item.path} mediaRef={mediaRef} kind="video" variant="compact" className="aspect-video w-full">
          <video ref={mediaRef} className="h-full w-full bg-black object-contain">
            <source src={mediaFileUrl(item.path)} />
          </video>
        </PlayerSkin>
      )}
    </div>
  )
}
