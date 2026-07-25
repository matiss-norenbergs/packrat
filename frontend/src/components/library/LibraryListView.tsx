import { useEffect, useState } from "react"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useLibraryQuery } from "@/hooks/useLibrary"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { librarySmallThumbnailUrl } from "@/lib/api"
import { cn, formatBytes, formatDuration, hashText } from "@/lib/utils"
import type { LibrarySortKey } from "@/lib/libraryFilters"
import type { LibraryItem } from "@/types/api"
import { LIBRARY_COLUMNS, useLibraryColumns, type LibraryColumnKey } from "./LibraryColumnsContext"
import { LibraryItemActionsMenu } from "./LibraryItemActionsMenu"
import { LibraryPagination } from "./LibraryPagination"
import { useRevealAll } from "./RevealAllContext"
import { useSelection } from "./SelectionContext"

// Caps how many tag badges a row shows before collapsing the rest into a
// "+N" badge — mirrors LibraryCard's MAX_VISIBLE_TAGS, keeping every row the
// same height regardless of tag count.
const MAX_VISIBLE_TAGS = 3

export function LibraryListView() {
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const [page, setPage] = useState(1)
  const { isRevealed, toggleItem: toggleReveal } = useRevealAll()
  const { selectionActive, isItemSelected, toggleItem: toggleSelected, selectItems, deselectItems } = useSelection()
  const { visibleColumns } = useLibraryColumns()
  const mode = (settings?.libraryMode as "manage" | "details") || "manage"

  const search = searchParams.get("q") ?? ""
  const sortKey = (settings?.librarySortKey as LibrarySortKey) || "downloadedAt"
  const sortDir = settings?.librarySortDir === "asc" ? "asc" : "desc"
  const collectionId = searchParams.get("collection")
  const year = searchParams.get("year")
  const tagNames = (searchParams.get("tags") ?? "").split(",").filter(Boolean)
  const paginationEnabled = settings?.libraryPaginationEnabled ?? false
  const pageSize = settings?.libraryPageSize || 48
  const hasFilters = Boolean(search || collectionId || year || tagNames.length > 0)

  const tagsKey = tagNames.join(",")
  useEffect(() => {
    setPage(1)
  }, [search, collectionId, year, tagsKey, sortKey, sortDir])

  const { data, isLoading, isError, error } = useLibraryQuery({
    q: search || undefined,
    collectionId: collectionId ? Number(collectionId) : undefined,
    year: year ? Number(year) : undefined,
    tags: tagNames.length > 0 ? tagNames : undefined,
    sortKey,
    sortDir,
    page: paginationEnabled ? page : undefined,
    pageSize: paginationEnabled ? pageSize : undefined,
  })

  const handleSort = (key: LibrarySortKey) => {
    if (sortKey === key) {
      updateSettings.mutate({ librarySortDir: sortDir === "asc" ? "desc" : "asc" })
    } else {
      updateSettings.mutate({ librarySortKey: key, librarySortDir: "asc" })
    }
  }

  if (isLoading || settingsLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (isError) {
    return <p className="text-sm text-destructive">Failed to load library: {(error as Error).message}</p>
  }

  if (!data || data.total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {hasFilters
          ? "No library items match these filters."
          : "Nothing here yet. Completed downloads will show up in your library."}
      </p>
    )
  }

  const columns = LIBRARY_COLUMNS.filter((col) => visibleColumns.has(col.key))

  // Selects/deselects every row currently loaded on this page — not
  // whatever matches the current filters beyond it, since the list is
  // paginated and only this page's items are in `data.items` to begin with.
  const pageSelectedCount = data.items.filter((i) => isItemSelected(i.id)).length
  const allOnPageSelected = pageSelectedCount === data.items.length
  const toggleSelectAll = () => {
    if (allOnPageSelected) {
      deselectItems(data.items.map((i) => i.id))
    } else {
      selectItems(data.items)
    }
  }

  return (
    <div className="space-y-4">
      <Table containerClassName="relative max-h-[calc(100vh-239px)] w-full overflow-auto rounded-md border">
        <TableHeader>
          <TableRow>
            {mode === "manage" && (
              <TableHead className="w-10">
                <Checkbox
                  checked={pageSelectedCount === 0 ? false : allOnPageSelected ? true : "indeterminate"}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </TableHead>
            )}
            <TableHead className="w-16">Thumb</TableHead>
            <TableHead className="min-w-48">
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-foreground"
                onClick={() => handleSort("title")}
              >
                Title
                {sortKey === "title" &&
                  (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
              </button>
            </TableHead>
            {columns.map((col) => (
              <TableHead key={col.key} className={col.headerClassName}>
                {col.sortKey ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => handleSort(col.sortKey!)}
                  >
                    {col.label}
                    {sortKey === col.sortKey &&
                      (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                ) : (
                  col.label
                )}
              </TableHead>
            ))}
            {mode === "manage" && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((item) => (
            <LibraryListRow
              key={item.id}
              item={item}
              mode={mode}
              columns={columns.map((c) => c.key)}
              revealed={isRevealed(item.id)}
              onToggleReveal={() => toggleReveal(item.id)}
              selectionActive={selectionActive}
              selected={isItemSelected(item.id)}
              onToggleSelected={() => toggleSelected(item)}
              backTo={`${location.pathname}${location.search}`}
            />
          ))}
        </TableBody>
      </Table>
      {paginationEnabled && <LibraryPagination page={page} pageSize={pageSize} total={data.total} onPageChange={setPage} />}
    </div>
  )
}

// Formats the combined Season/Episode column — mirrors LibraryCard's
// "details" mode formatting (S01E02-style), but with the list's "—" empty
// convention instead of that panel's "-".
function formatSeasonEpisode(item: LibraryItem): string {
  if (item.seasonNumber == null && item.sequenceNumber == null) return "—"
  const season = item.seasonNumber != null ? `S${String(item.seasonNumber).padStart(2, "0")}` : ""
  const episode = item.sequenceNumber != null ? `E${String(item.sequenceNumber).padStart(2, "0")}` : ""
  return `${season}${episode}`
}

function renderColumnCell(key: LibraryColumnKey, item: LibraryItem, visibleTags: string[], hiddenTags: string[]) {
  switch (key) {
    case "seasonEpisode":
      return formatSeasonEpisode(item)
    case "year":
      return item.year ?? "—"
    case "duration":
      return formatDuration(item.duration)
    case "downloadedAt":
      return new Date(item.downloadedAt).toLocaleDateString()
    case "artist":
      return item.artistName ?? item.uploader ?? "—"
    case "collection":
      return item.collectionName ?? "Uncategorized"
    case "size":
      return item.fileSizeBytes != null ? formatBytes(item.fileSizeBytes) : "—"
    case "tags":
      return (
        item.tags.length > 0 && (
          // The whole tag row is the trigger (not just the "+N" overflow
          // badge) so clicking anywhere reveals the complete, unclipped
          // list — the row itself only ever shows a truncated preview.
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex flex-nowrap items-center gap-1 rounded outline-hidden hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={(e) => e.stopPropagation()}
              >
                {visibleTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="min-w-0 shrink truncate">
                    {tag}
                  </Badge>
                ))}
                {hiddenTags.length > 0 && (
                  <Badge variant="secondary" className="shrink-0">
                    +{hiddenTags.length}
                  </Badge>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto max-w-xs" align="start" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap gap-1">
                {item.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )
      )
  }
}

function LibraryListRow({
  item,
  mode,
  columns,
  revealed,
  onToggleReveal,
  selectionActive,
  selected,
  onToggleSelected,
  backTo,
}: {
  item: LibraryItem
  mode: "manage" | "details"
  columns: LibraryColumnKey[]
  revealed: boolean
  onToggleReveal: () => void
  selectionActive: boolean
  selected: boolean
  onToggleSelected: () => void
  backTo: string
}) {
  const visibleTags = item.tags.slice(0, MAX_VISIBLE_TAGS)
  const hiddenTags = item.tags.slice(MAX_VISIBLE_TAGS)
  const columnDefsByKey = Object.fromEntries(LIBRARY_COLUMNS.map((c) => [c.key, c]))
  const thumbUrl = librarySmallThumbnailUrl(item)

  return (
    <TableRow
      className={cn(selectionActive && "cursor-pointer")}
      onClick={selectionActive ? onToggleSelected : undefined}
      data-state={selected ? "selected" : undefined}
    >
      {mode === "manage" && (
        <TableCell>
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelected}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select"
          />
        </TableCell>
      )}
      <TableCell>
        <div className="relative aspect-video w-14 overflow-hidden rounded bg-muted">
          {thumbUrl && (
            <BlurredThumbnail
              src={thumbUrl}
              className="absolute inset-0 h-full w-full object-cover"
              blurred={item.blurred}
              revealed={revealed}
              onToggleReveal={selectionActive ? () => {} : onToggleReveal}
              interactive={!selectionActive}
            />
          )}
        </div>
      </TableCell>
      <TableCell className="max-w-64 min-w-48">
        <Link
          to={`/library/${item.id}`}
          state={{ from: backTo }}
          className={cn("block truncate font-medium hover:underline", selectionActive && "pointer-events-none")}
        >
          {item.sequenceNumber != null && `${item.sequenceNumber}. `}
          {item.blurred && !revealed ? hashText(item.title) : item.title}
        </Link>
      </TableCell>
      {columns.map((key) => (
        <TableCell key={key} className={columnDefsByKey[key]?.cellClassName}>
          {renderColumnCell(key, item, visibleTags, hiddenTags)}
        </TableCell>
      ))}
      {mode === "manage" && (
        <TableCell onClick={(e) => e.stopPropagation()}>{!selectionActive && <LibraryItemActionsMenu item={item} />}</TableCell>
      )}
    </TableRow>
  )
}
