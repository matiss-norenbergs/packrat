import { useCallback, useEffect, type RefObject } from "react"
import { PlayerSkin } from "@/components/player/PlayerSkin"
import { libraryMediumThumbnailUrl, mediaFileUrl } from "@/lib/api"
import { usePersistedVolume } from "@/hooks/usePersistedVolume"
import { isAudioFilename } from "@/lib/utils"
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

// One cell in the compare-play grid: the player skin (compact variant, one overlay row: play, seek, time,
// volume) around the item's own <video>/<audio>, so each cell keeps independent controls. The cell uses
// shortcuts="focus": its keys act only while the cell has focus (the page's global scope handles the rest), and
// the cell shows a highlight ring while it contains focus, mouse click included, so it is visible which scope
// Space will act on. No speed pill or fullscreen button here: the global bar provides those. Fills its grid cell
// completely (h-full w-full, no aspect-ratio box) so the parent grid decides each item's size; the title is an
// overlay inside the video, not its own row.
export function ComparePlayerCell({ item, registerMedia, preload, onReadyChange }: ComparePlayerCellProps) {
  const { isRevealed, toggleItem } = useRevealAll()
  const revealed = isRevealed(item.id)
  const locked = item.blurred && !revealed
  // The element mounts when a locked cell is revealed, so the persisted volume re-attaches then.
  const audioRef = usePersistedVolume<HTMLAudioElement>(locked)
  const videoRef = usePersistedVolume<HTMLVideoElement>(locked)
  const isVideo = !isAudioFilename(item.filename)

  // Locked cells have no mounted media element to report canplaythrough —
  // count them as ready immediately so they don't block "wait for ready"
  // for the rest of the set; a freshly-revealed cell flips back to
  // not-ready until its own element buffers up.
  useEffect(() => {
    onReadyChange(locked)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onReadyChange is the parent's un-memoized callback; report only when locked flips
  }, [locked])

  // Stable callbacks: a new ref function each render would unregister and re-register the element every time.
  const setVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      ;(videoRef as RefObject<HTMLVideoElement | null>).current = el
      registerMedia(el)
    },
    [videoRef, registerMedia],
  )
  const setAudioRef = useCallback(
    (el: HTMLAudioElement | null) => {
      ;(audioRef as RefObject<HTMLAudioElement | null>).current = el
      registerMedia(el)
    },
    [audioRef, registerMedia],
  )

  const preloadAttr = preload ? "auto" : "metadata"
  const artist = item.artistName ?? item.uploader ?? undefined

  return (
    <div
      data-slot="compare-cell"
      className={`group/cell relative h-full w-full overflow-hidden border border-white/10 ${!locked && !isVideo ? "bg-background" : "bg-black"}`}
    >
      {locked ? (
        <>
          <p className="pointer-events-none absolute top-0 left-0 z-10 max-w-full truncate bg-gradient-to-b from-black/80 to-transparent px-2 py-1 text-xs font-medium text-white">
            Private item
          </p>
          <button type="button" onClick={() => toggleItem(item.id)} className="flex h-full w-full flex-col items-center justify-center gap-1 text-white">
            <span className="text-xs font-medium">This item is private</span>
            <span className="text-[11px] text-white/70">Click to reveal and play</span>
          </button>
        </>
      ) : isVideo ? (
        <PlayerSkin key={item.path} mediaRef={videoRef} kind="video" variant="compact" shortcuts="focus" titleOverlay={item.title} className="h-full w-full">
          <video
            ref={setVideoRef}
            preload={preloadAttr}
            onCanPlayThrough={() => onReadyChange(true)}
            onWaiting={() => onReadyChange(false)}
            className="h-full w-full object-contain"
          >
            <source src={mediaFileUrl(item.path)} />
          </video>
        </PlayerSkin>
      ) : (
        <PlayerSkin
          key={item.path}
          mediaRef={audioRef}
          kind="audio"
          variant="compact"
          shortcuts="focus"
          title={item.title}
          artist={artist}
          coverUrl={item.thumbnail ? libraryMediumThumbnailUrl(item) : null}
          coverPx={56}
          className="flex h-full w-full flex-col justify-center"
        >
          <audio ref={setAudioRef} preload={preloadAttr} onCanPlayThrough={() => onReadyChange(true)} onWaiting={() => onReadyChange(false)}>
            <source src={mediaFileUrl(item.path)} />
          </audio>
        </PlayerSkin>
      )}
      {/* Focus highlight: :focus-within, so it shows after a mouse click too (not only keyboard focus). */}
      <div
        aria-hidden
        data-slot="compare-cell-focus"
        className="pointer-events-none absolute inset-0 z-40 ring-2 ring-inset ring-ring opacity-0 transition-opacity group-focus-within/cell:opacity-100 motion-reduce:transition-none"
      />
    </div>
  )
}
