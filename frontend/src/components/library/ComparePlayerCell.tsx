import { useEffect, useState } from "react"
import { Music } from "lucide-react"
import { libraryMediumThumbnailUrl, mediaFileUrl } from "@/lib/api"
import { usePersistedVolume } from "@/hooks/usePersistedVolume"
import { cn, isAudioFilename } from "@/lib/utils"
import { useRevealAll } from "./RevealAllContext"
import type { LibraryItem } from "@/types/api"

interface ComparePlayerCellProps {
  item: LibraryItem
  // Hands the mounted <video>/<audio> element up to the parent grid so the
  // global play-all/pause-all/master-volume controls can reach it directly
  // — called with null on unmount (item removed from the set, or this cell
  // is locked/private) so the parent's ref map never holds a stale element.
  registerMedia: (el: HTMLMediaElement | null) => void
  // Whether to buffer aggressively (preload="auto") ahead of any play
  // action, vs. the browser's own default (preload="metadata") — a
  // user-facing toggle in ComparePlayPage's bottom bar, since it trades
  // more up-front network/decode work for less chance of a mid-playback
  // stall.
  preload: boolean
  // Reports whether this item has buffered enough to play through without
  // stalling (canplaythrough), so "Play all" can optionally wait for every
  // cell before starting anything. A locked/private item has nothing to
  // buffer yet, so it reports ready immediately rather than blocking the
  // other cells until someone reveals it.
  onReadyChange: (ready: boolean) => void
}

// One cell in the compare-play grid — same native <video controls>/<audio
// controls> rendering LibraryItemDetail uses (no custom player chrome
// needed: the bottom bar just reaches into the DOM element directly, and
// native controls reflect whatever it sets), just without the sibling
// strip/metadata panel/minimize button, since those don't make sense
// alongside five other items. Fills its grid cell completely (h-full
// w-full, no aspect-ratio box, no gap/border spacing) so the parent grid's
// own sizing is what determines how much room each item gets — the title
// lives in an overlay instead of its own row, so none of that space is
// spent on chrome.
export function ComparePlayerCell({ item, registerMedia, preload, onReadyChange }: ComparePlayerCellProps) {
  const { isRevealed, toggleItem } = useRevealAll()
  const revealed = isRevealed(item.id)
  const locked = item.blurred && !revealed
  const audioRef = usePersistedVolume<HTMLAudioElement>()
  const videoRef = usePersistedVolume<HTMLVideoElement>()
  const isVideo = !isAudioFilename(item.filename)
  // Title shows whenever paused (nothing to hide it for) or on hover while
  // playing — mirrors a typical video player's title-fades-in-on-interaction
  // behavior, so it doesn't sit over the picture the whole time.
  const [paused, setPaused] = useState(true)

  // Locked cells have no mounted media element to report canplaythrough —
  // count them as ready immediately so they don't block "wait for ready"
  // for the rest of the set; a freshly-revealed cell flips back to
  // not-ready until its own element buffers up.
  useEffect(() => {
    onReadyChange(locked)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked])

  const setVideoRef = (el: HTMLVideoElement | null) => {
    videoRef.current = el
    registerMedia(el)
  }
  const setAudioRef = (el: HTMLAudioElement | null) => {
    audioRef.current = el
    registerMedia(el)
  }

  const preloadAttr = preload ? "auto" : "metadata"

  return (
    <div className="group relative h-full w-full overflow-hidden border border-white/10 bg-black">
      <p
        className={cn(
          "pointer-events-none absolute top-0 left-0 z-10 max-w-full truncate bg-gradient-to-b from-black/80 to-transparent px-2 py-1 text-xs font-medium text-white transition-opacity",
          paused ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        {locked ? "Private item" : item.title}
      </p>
      {locked ? (
        <button
          type="button"
          onClick={() => toggleItem(item.id)}
          className="flex h-full w-full flex-col items-center justify-center gap-1 text-white"
        >
          <span className="text-xs font-medium">This item is private</span>
          <span className="text-[11px] text-white/70">Click to reveal and play</span>
        </button>
      ) : isVideo ? (
        <video
          key={item.path}
          ref={setVideoRef}
          controls
          preload={preloadAttr}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onCanPlayThrough={() => onReadyChange(true)}
          onWaiting={() => onReadyChange(false)}
          className="h-full w-full object-contain"
        >
          <source src={mediaFileUrl(item.path)} />
        </video>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3">
          <div className="aspect-square h-full max-h-[60%] w-auto overflow-hidden rounded bg-neutral-800">
            {item.thumbnail ? (
              <img src={libraryMediumThumbnailUrl(item)!} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Music className="h-8 w-8 text-white/30" />
              </div>
            )}
          </div>
          <audio
            key={item.path}
            ref={setAudioRef}
            controls
            preload={preloadAttr}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onCanPlayThrough={() => onReadyChange(true)}
            onWaiting={() => onReadyChange(false)}
            className="w-full"
          >
            <source src={mediaFileUrl(item.path)} />
          </audio>
        </div>
      )}
    </div>
  )
}
