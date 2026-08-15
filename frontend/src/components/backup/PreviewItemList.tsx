import { Badge } from "@/components/ui/badge"
import type { LibraryImportMode, LibraryImportPreview, PreviewLibraryItem } from "@/types/api"

interface PreviewItemListProps {
  preview: LibraryImportPreview
  mode: LibraryImportMode
}

// Shared between LibraryImportPreviewDialog and FullImportPreviewDialog —
// both preview a library bundle (a standalone export, or the library half of
// a full backup) against the same download-vs-ghost-only mode toggle, so the
// summary line + scrollable item list only needs to exist once.
export function PreviewItemList({ preview, mode }: PreviewItemListProps) {
  // Go serializes an empty/nil slice as JSON null, not [] — a library with
  // no tags (etc.) at all sends null, so every array here needs a fallback.
  const collections = preview.collections ?? []
  const tags = preview.tags ?? []
  const artists = preview.artists ?? []
  const items = preview.items ?? []

  // ghostCount and newDownloads always partition items.length — "already in
  // library" is a separate, independent flag (ApplyLibraryBundle never skips
  // a duplicate, it always creates the ghost or queues the download), so it
  // must NOT also be subtracted here or the total undercounts (and can go
  // negative when a ghost item happens to also be a duplicate). The preview
  // response is mode-agnostic (isGhost reflects what the file itself
  // carries) — "ghost only" mode routes every item into the ghost count.
  const fileGhostCount = items.filter((item) => item.isGhost).length
  const ghostCount = mode === "ghostOnly" ? items.length : fileGhostCount
  const newDownloads = mode === "ghostOnly" ? 0 : items.length - fileGhostCount

  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{collections.length}</span> collections
          {preview.collectionsNew > 0 && ` (${preview.collectionsNew} new)`}
        </span>
        <span>
          <span className="font-medium text-foreground">{tags.length}</span> tags
          {preview.tagsNew > 0 && ` (${preview.tagsNew} new)`}
        </span>
        <span>
          <span className="font-medium text-foreground">{artists.length}</span> artists
          {preview.artistsNew > 0 && ` (${preview.artistsNew} new)`}
        </span>
        <span>
          <span className="font-medium text-foreground">{items.length}</span> items —{" "}
          <span className="font-medium text-foreground">{newDownloads}</span> will be queued
          {ghostCount > 0 && `, ${ghostCount} restored as ghost items`}
          {preview.alreadyInLibrary > 0 && `, ${preview.alreadyInLibrary} already in your library`}
        </span>
      </div>

      <div className="max-h-[50vh] space-y-2 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-1 py-1 text-sm text-muted-foreground">No library items in this file.</p>
        ) : (
          items.map((item, i) => (
            <PreviewItemRow key={`${item.originalUrl}-${i}`} item={item} willBeGhost={mode === "ghostOnly" || Boolean(item.isGhost)} />
          ))
        )}
      </div>
    </>
  )
}

function PreviewItemRow({ item, willBeGhost }: { item: PreviewLibraryItem; willBeGhost: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-2">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium">{item.title || item.originalUrl}</p>
        {item.originalUrl && <p className="truncate text-xs text-muted-foreground">{item.originalUrl}</p>}
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline">
            {item.collectionPath && item.collectionPath.length > 0 ? item.collectionPath.join(" / ") : "Uncategorized"}
          </Badge>
          {item.artistName && <Badge variant="outline">{item.artistName}</Badge>}
          {item.tags?.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {willBeGhost && <Badge variant="outline">Ghost</Badge>}
        {item.alreadyInLibrary && <Badge variant="secondary">Already in library</Badge>}
      </div>
    </div>
  )
}
