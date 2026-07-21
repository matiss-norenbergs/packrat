import { useEffect } from "react"
import { Link } from "react-router-dom"
import { Minimize2, Music } from "lucide-react"
import { syncMediaOnReady } from "@/lib/mediaSeek"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { mediaFileUrl } from "@/lib/api"
import { usePlaybackProgress } from "@/hooks/usePlaybackProgress"
import { useSettings } from "@/hooks/useSettings"
import { sortLibraryItems, type LibrarySortDir, type LibrarySortKey } from "@/lib/libraryFilters"
import { formatBytes, hashText, isAudioFilename } from "@/lib/utils"
import { LibraryItemActionsMenu } from "./LibraryItemActionsMenu"
import { LibraryItemStripTile } from "./LibraryItemStripTile"
import { useRevealAll } from "./RevealAllContext"
import { usePersistedVolume } from "@/hooks/usePersistedVolume"
import type { LibraryItem } from "@/types/api"

// The full detail/player view for one library item — video/audio playback,
// private-item blur/reveal, metadata panel, and a "more from this
// collection" sibling strip. Shared between /library/:id (inside the
// management chrome) and /browse/:id (inside the Browse chrome) — callers
// are expected to wrap this in their own RevealAllProvider. basePath is
// forwarded to the sibling strip tiles so navigating between siblings stays
// under whichever chrome this is currently rendered in. playerHeightClass
// sizes the player to reach the bottom of the viewport — it's caller-supplied
// because the two chromes eat different amounts of vertical space above the
// player (AppLayout's MobileNav vs. BrowseLayout's header), and only the
// caller knows which chrome it's rendering inside. resumeAt/resumePaused
// restore playback position and play/pause state (used when restoring from
// the Browse mini-player) — resumePaused, when set, overrides the autoplay
// setting so a paused-then-expanded item doesn't unexpectedly start playing.
// onMinimize, if provided, shows a "Minimize" button next to Back — only
// BrowseItemPage passes it, since the mini-player is a Browse-only feature.
// ignorePrivacy, if true, treats this item and its siblings as unblurred —
// only BrowseItemPage passes it (from the browseIgnorePrivacy setting);
// LibraryItemPage never does, so Library's blur behavior is unaffected.
export function LibraryItemDetail({
  item,
  items,
  backTo,
  basePath = "/library",
  playerHeightClass,
  resumeAt,
  resumePaused,
  onMinimize,
  ignorePrivacy = false,
}: {
  item: LibraryItem
  items: LibraryItem[]
  backTo: string
  basePath?: string
  playerHeightClass: string
  resumeAt?: number
  resumePaused?: boolean
  onMinimize?: (currentTime: number, paused: boolean) => void
  ignorePrivacy?: boolean
}) {
  const { data: settings } = useSettings()
  const { isRevealed, toggleItem, revealItems } = useRevealAll()
  const revealed = isRevealed(item.id)
  const effectiveBlurred = item.blurred && !ignorePrivacy
  const locked = effectiveBlurred && !revealed

  const autoPlay = resumePaused != null ? !resumePaused : (settings?.libraryAutoplay ?? true)
  const audioRef = usePersistedVolume<HTMLAudioElement>()
  const videoRef = usePersistedVolume<HTMLVideoElement>()
  const isVideo = !isAudioFilename(item.filename)

  // resumeAt (mini-player hand-off) wins when present; otherwise fall back
  // to the persisted server-side position powering Continue Watching — only
  // meaningful for video, since playback position is never tracked for
  // music (see usePlaybackProgress below).
  const effectiveResumeAt = resumeAt ?? (isVideo && item.playbackPositionSeconds ? item.playbackPositionSeconds : undefined)

  // Runs after commit, once the ref is populated — see syncMediaOnReady for
  // why this can't just be the JSX onLoadedMetadata prop.
  useEffect(() => {
    const el = isAudioFilename(item.filename) ? audioRef.current : videoRef.current
    if (!el) return
    return syncMediaOnReady(el, effectiveResumeAt, autoPlay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.path])

  // Video only, per Continue Watching's scope — music has no "continue
  // watching" concept, so audio items never report a position at all.
  usePlaybackProgress(videoRef, item.id, isVideo && !locked)

  const sortKey = (settings?.librarySortKey as LibrarySortKey) || "downloadedAt"
  const sortDir: LibrarySortDir = settings?.librarySortDir === "asc" ? "asc" : "desc"
  const siblings = sortLibraryItems(
    items.filter((i) => item.collectionId != null && i.collectionId === item.collectionId && i.id !== item.id),
    sortKey,
    sortDir,
  )

  // Revealing the main item also reveals the rest of the collection shown
  // below it — the whole strip was already visually "part of" this private
  // item, so making the viewer reveal each sibling separately felt redundant.
  const toggleReveal = () => {
    toggleItem(item.id)
    revealItems(siblings.map((s) => s.id))
  }

  // A prose-style summary line rather than the Edit dialog's label/value
  // grid — only the parts that actually have a value, joined into one
  // readable line. Season/episode gets its own line above it (see render)
  // rather than being folded in here.
  const episodeParts = []
  if (item.seasonNumber != null) episodeParts.push(`Season ${item.seasonNumber}`)
  if (item.sequenceNumber != null) episodeParts.push(`Episode ${item.sequenceNumber}`)

  const summaryParts = [
    `${item.downloadId == null ? "Imported" : "Downloaded"} ${new Date(item.downloadedAt).toLocaleDateString()}`,
  ]
  if (item.fileSizeBytes != null) summaryParts.push(formatBytes(item.fileSizeBytes))
  if (item.year != null) summaryParts.push(String(item.year))

  return (
    <div>
      <div className={`-m-4 bg-black md:-m-6 ${playerHeightClass}`}>
        {locked ? (
          <button
            type="button"
            onClick={toggleReveal}
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-white"
          >
            <span className="text-sm font-medium">This item is private</span>
            <span className="text-xs text-white/70">Click to reveal and play</span>
          </button>
        ) : isAudioFilename(item.filename) ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8">
            <div className="aspect-square h-full max-h-72 w-auto overflow-hidden rounded-lg bg-neutral-800 shadow-lg">
              {item.thumbnail ? (
                <img src={mediaFileUrl(item.thumbnail)} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Music className="h-16 w-16 text-white/30" />
                </div>
              )}
            </div>
            <div className="text-center">
              <p className="text-base font-medium text-white">{item.title}</p>
              <p className="text-sm text-white/70">{item.artistName ?? item.uploader ?? "Unknown artist"}</p>
            </div>
            <audio key={item.path} ref={audioRef} controls className="w-full max-w-md">
              <source src={mediaFileUrl(item.path)} />
            </audio>
          </div>
        ) : (
          <video key={item.path} ref={videoRef} controls className="h-full w-full object-contain">
            <source src={mediaFileUrl(item.path)} />
          </video>
        )}
      </div>

      <div className="space-y-6 pt-8 md:pt-10">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <h1 className="text-xl font-semibold">
                {item.sequenceNumber != null && `${item.sequenceNumber}. `}
                {locked ? hashText(item.title) : item.title}
              </h1>
              <p className="text-sm text-muted-foreground">{item.artistName ?? item.uploader ?? "Uncategorized"}</p>
            </div>
            <LibraryItemActionsMenu item={item} />
          </div>

          <div className="flex flex-wrap gap-1">
            <Badge variant="outline">{item.collectionName ?? "Uncategorized"}</Badge>
            {item.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>

          <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
            {episodeParts.length > 0 && <p className="font-medium text-foreground">{episodeParts.join(", ")}</p>}
            <p>{summaryParts.join(" · ")}</p>
            {!locked && item.description && <p>{item.description}</p>}
            {!locked && item.originalUrl && (
              <a
                href={item.originalUrl}
                target="_blank"
                rel="noreferrer"
                className="block truncate underline underline-offset-2"
              >
                {item.originalUrl}
              </a>
            )}
          </div>

          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={backTo}>← Back</Link>
            </Button>
            {onMinimize && !locked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const el = (isAudioFilename(item.filename) ? audioRef : videoRef).current
                  onMinimize(el?.currentTime ?? 0, el?.paused ?? false)
                }}
              >
                <Minimize2 className="h-3.5 w-3.5" />
                Minimize
              </Button>
            )}
          </div>
        </div>

        {siblings.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">More from this collection</h2>
            <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-2">
              {siblings.map((sibling) => (
                <LibraryItemStripTile
                  key={sibling.id}
                  item={sibling}
                  backTo={backTo}
                  basePath={basePath}
                  ignorePrivacy={ignorePrivacy}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
