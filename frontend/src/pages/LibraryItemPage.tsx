import { Link, useParams } from "react-router-dom"
import { Music } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { mediaFileUrl } from "@/lib/api"
import { useLibrary } from "@/hooks/useLibrary"
import { useSettings } from "@/hooks/useSettings"
import { sortLibraryItems, type LibrarySortDir, type LibrarySortKey } from "@/lib/libraryFilters"
import { formatBytes, hashText, isAudioFilename } from "@/lib/utils"
import { LibraryItemActionsMenu } from "@/components/library/LibraryItemActionsMenu"
import { LibraryItemStripTile } from "@/components/library/LibraryItemStripTile"
import { RevealAllProvider, useRevealAll } from "@/components/library/RevealAllContext"
import type { LibraryItem } from "@/types/api"

export function LibraryItemPage() {
  const { id } = useParams<{ id: string }>()
  const { data: items, isLoading } = useLibrary()
  const item = items?.find((i) => i.id === Number(id))

  if (isLoading) {
    return (
      <div>
        <div className="-m-4 md:-m-6">
          <Skeleton className="aspect-video w-full rounded-none" />
        </div>
        <div className="space-y-2 pt-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
    )
  }

  if (!items || !item) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">This library item doesn't exist (it may have been deleted).</p>
        <Button asChild variant="outline">
          <Link to="/library">Back to Library</Link>
        </Button>
      </div>
    )
  }

  return (
    <RevealAllProvider>
      <LibraryItemPageContent item={item} items={items} />
    </RevealAllProvider>
  )
}

function LibraryItemPageContent({ item, items }: { item: LibraryItem; items: LibraryItem[] }) {
  const { data: settings } = useSettings()
  const { isRevealed, toggleItem } = useRevealAll()
  const revealed = isRevealed(item.id)
  const toggleReveal = () => toggleItem(item.id)
  const locked = item.blurred && !revealed

  const sortKey = (settings?.librarySortKey as LibrarySortKey) || "downloadedAt"
  const sortDir: LibrarySortDir = settings?.librarySortDir === "asc" ? "asc" : "desc"
  const siblings = sortLibraryItems(
    items.filter((i) => item.collectionId != null && i.collectionId === item.collectionId && i.id !== item.id),
    sortKey,
    sortDir,
  )

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
      <div className="-m-4 bg-black md:-m-6">
        {locked ? (
          <button
            type="button"
            onClick={toggleReveal}
            className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-white"
          >
            <span className="text-sm font-medium">This item is private</span>
            <span className="text-xs text-white/70">Click to reveal and play</span>
          </button>
        ) : isAudioFilename(item.filename) ? (
          <div className="flex flex-col items-center gap-4 p-8">
            <div className="aspect-square w-full max-w-xs overflow-hidden rounded-lg bg-neutral-800 shadow-lg">
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
            <audio key={item.path} controls autoPlay className="w-full max-w-md">
              <source src={mediaFileUrl(item.path)} />
            </audio>
          </div>
        ) : (
          <video key={item.path} controls autoPlay className="mx-auto max-h-[70vh] w-full object-contain">
            <source src={mediaFileUrl(item.path)} />
          </video>
        )}
      </div>

      <div className="space-y-6 pt-6">
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

          <Button asChild variant="outline" size="sm">
            <Link to="/library">← Back to Library</Link>
          </Button>
        </div>

        {siblings.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">More from this collection</h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {siblings.map((sibling) => (
                <LibraryItemStripTile key={sibling.id} item={sibling} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
