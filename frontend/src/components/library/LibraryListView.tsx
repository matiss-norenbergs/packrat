import type { ReactNode } from "react"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { MediaTypePlaceholder } from "@/components/MediaTypePlaceholder"
import { useLibraryQuery } from "@/hooks/useLibrary"
import { usePageState } from "@/hooks/usePageState"
import { useSettings } from "@/hooks/useSettings"
import { useArtistNameMask } from "@/hooks/useArtistNameMask"
import { useTagNameMask } from "@/hooks/useTagNameMask"
import { DEFAULT_LIBRARY_SORT, LIBRARY_TABLE_ID, useLibrarySort } from "@/hooks/useLibrarySort"
import { librarySmallThumbnailUrl } from "@/lib/api"
import { LIBRARY_LIST_COLUMN_SPECS, LIBRARY_LIST_EXTRA_SORT_KEYS } from "@/lib/libraryListColumns"
import { formatBytes, formatDuration, hashText } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"
import { toContextMenuItems, useLibraryItemActions } from "./libraryItemActions"
import { useRevealAll } from "./RevealAllContext"
import { useSelection } from "./SelectionContext"
import { LibraryFiltersButton, LibrarySettingsPopover, LibraryToolbarActions } from "./LibraryToolbar"
import { useLibraryToolbar } from "./useLibraryToolbar"
import { useLibraryListSelection } from "./useLibraryListSelection"

// Caps how many tag badges a row shows before collapsing the rest into a
// "+N" badge — mirrors LibraryCard's MAX_VISIBLE_TAGS, keeping every row the
// same height regardless of tag count.
const MAX_VISIBLE_TAGS = 3

// Formats the combined Season/Episode column — mirrors LibraryCard's
// "details" mode formatting (S01E02-style), but with the list's "—" empty
// convention instead of that panel's "-".
function formatSeasonEpisode(item: LibraryItem): string {
  if (item.seasonNumber == null && item.sequenceNumber == null) return "—"
  const season = item.seasonNumber != null ? `S${String(item.seasonNumber).padStart(2, "0")}` : ""
  const episode = item.sequenceNumber != null ? `E${String(item.sequenceNumber).padStart(2, "0")}` : ""
  return `${season}${episode}`
}

// The cells that depend on page state (reveal, the current URL) are components that read their context themselves, so
// COLUMNS is a module-level constant and a reveal re-renders only these cells.
function ThumbCell({ item }: { item: LibraryItem }) {
  const { isRevealed, toggleItem } = useRevealAll()
  const thumbUrl = librarySmallThumbnailUrl(item)
  return (
    // A blurred thumbnail is revealed by clicking the image, which is neither a button nor a link, so the wrapper opts
    // out of row selection (an unblurred one has nothing to click and stays part of the row).
    <div className="relative aspect-video w-14 overflow-hidden rounded bg-muted" data-no-row-select={thumbUrl && item.blurred ? "" : undefined}>
      {thumbUrl ? (
        <BlurredThumbnail
          src={thumbUrl}
          className="absolute inset-0 h-full w-full object-cover"
          blurred={item.blurred}
          revealed={isRevealed(item.id)}
          onToggleReveal={() => toggleItem(item.id)}
        />
      ) : (
        <MediaTypePlaceholder mediaType={item.mediaType} iconClassName="h-4 w-4" />
      )}
    </div>
  )
}

function TitleCell({ item }: { item: LibraryItem }) {
  const { isRevealed } = useRevealAll()
  const location = useLocation()
  return (
    <Link to={`/library/${item.id}`} state={{ from: `${location.pathname}${location.search}` }} className="block truncate font-medium hover:underline">
      {item.sequenceNumber != null && `${item.sequenceNumber}. `}
      {item.blurred && !isRevealed(item.id) ? hashText(item.title) : item.title}
    </Link>
  )
}

function ArtistCell({ item }: { item: LibraryItem }) {
  const { isRevealed } = useRevealAll()
  const maskArtist = useArtistNameMask()
  if (!item.artistName) return <>{item.uploader ?? "—"}</>
  return <>{maskArtist(item.artistId, item.artistName, isRevealed(item.id) || !item.blurred)}</>
}

function TagsCell({ item }: { item: LibraryItem }) {
  const { isRevealed } = useRevealAll()
  const maskTag = useTagNameMask()
  const revealed = isRevealed(item.id) || !item.blurred
  if (item.tags.length === 0) return null
  const visibleTags = item.tags.slice(0, MAX_VISIBLE_TAGS)
  const hiddenTags = item.tags.slice(MAX_VISIBLE_TAGS)
  // The whole tag row is the trigger (not just the "+N" overflow
  // badge) so clicking anywhere reveals the complete, unclipped
  // list — the row itself only ever shows a truncated preview.
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex flex-nowrap items-center gap-1 rounded outline-hidden hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {visibleTags.map((tag) => (
            <Badge key={tag} variant="secondary" className="min-w-0 shrink truncate">
              {maskTag(tag, revealed)}
            </Badge>
          ))}
          {hiddenTags.length > 0 && (
            <Badge variant="secondary" className="shrink-0">
              +{hiddenTags.length}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-xs" align="start">
        <div className="flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {maskTag(tag, revealed)}
            </Badge>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Width, type, hideable / default-visible and the label come from the shared specs (lib/libraryListColumns.ts), which
// the Library's saved layout is normalized against too; only header, cell and sortValue are defined here. A sortable
// column's key is the server sort key, so the table's sort IS the query's sort and `sortValue` only marks it sortable
// (the controlled table never sorts rows).
const SPECS = Object.fromEntries(LIBRARY_LIST_COLUMN_SPECS.map((s) => [s.key, s]))
function column(key: string, def: Pick<ColumnDef<LibraryItem>, "cell" | "sortValue" | "tooltip"> & { header?: ReactNode }): ColumnDef<LibraryItem> {
  const { label, sortable: _sortable, ...spec } = SPECS[key]
  return { ...spec, header: label, ...def }
}

const COLUMNS: ColumnDef<LibraryItem>[] = [
  column("thumb", { cell: (item) => <ThumbCell item={item} />, tooltip: false }),
  column("title", { cell: (item) => <TitleCell item={item} />, sortValue: (item) => item.title }),
  column("seasonNumber", { cell: formatSeasonEpisode, sortValue: (item) => item.seasonNumber }),
  column("year", { cell: (item) => item.year ?? "—", sortValue: (item) => item.year }),
  column("duration", { cell: (item) => formatDuration(item.duration), sortValue: (item) => item.duration }),
  column("downloadedAt", { cell: (item) => new Date(item.downloadedAt).toLocaleDateString(), sortValue: (item) => new Date(item.downloadedAt) }),
  column("artist", { cell: (item) => <ArtistCell item={item} /> }),
  column("collection", { cell: (item) => item.collectionName ?? "Uncategorized" }),
  column("size", { cell: (item) => (item.fileSizeBytes != null ? formatBytes(item.fileSizeBytes) : "—") }),
  column("tags", { cell: (item) => <TagsCell item={item} /> }),
]

const NO_ITEMS: LibraryItem[] = []
const EXTRA_SORT_KEYS: string[] = [...LIBRARY_LIST_EXTRA_SORT_KEYS]
const ITEM_LABEL = { singular: "item", plural: "items" }
const noop = () => {}
const getItemId = (item: LibraryItem) => item.id

function ListSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}

export function LibraryListView() {
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const [searchParams] = useSearchParams()
  const { isRevealed } = useRevealAll()
  const { approxCount } = useSelection()
  // The Library toolbar's state, rendered through DataTable's slots (the classic sticky toolbar is not mounted in this view).
  const toolbar = useLibraryToolbar()

  const search = searchParams.get("q") ?? ""
  const { sort, ready: sortReady, layout, setLayout } = useLibrarySort()
  const { key: sortKey, dir: sortDir } = sort
  const collectionId = searchParams.get("collection")
  const year = searchParams.get("year")
  const tagNames = (searchParams.get("tags") ?? "").split(",").filter(Boolean)
  const hideGhosts = searchParams.get("hideGhosts") === "true"
  const paginationEnabled = settings?.libraryPaginationEnabled ?? false
  const pageSize = settings?.libraryPageSize || 48
  const hasFilters = Boolean(search || collectionId || year || tagNames.length > 0 || hideGhosts)

  const [page, setPage] = usePageState(JSON.stringify([search, collectionId, year, tagNames.join(","), hideGhosts, sortKey, sortDir]))

  const { data, isLoading, isError, error } = useLibraryQuery({
    q: search || undefined,
    collectionId: collectionId ? Number(collectionId) : undefined,
    year: year ? Number(year) : undefined,
    tags: tagNames.length > 0 ? tagNames : undefined,
    hideGhosts: hideGhosts || undefined,
    sortKey,
    sortDir,
    page: paginationEnabled ? page : undefined,
    pageSize: paginationEnabled ? pageSize : undefined,
  }, sortReady)

  const items = data?.items ?? NO_ITEMS
  const total = data?.total ?? 0
  const selection = useLibraryListSelection(items)
  // Row actions live in the right-click menu: the same actions as the "⋮" menus of the grid, one host for the table's dialogs.
  const { actionsFor, host: actionsHost } = useLibraryItemActions(undefined, items)
  // Per-row actions: only for exactly one target row. A right-click on a selected row while several items are selected opens
  // nothing (bulk actions are the toolbar's Bulk operations); a right-click on an unselected row selects just that row first.
  const contextMenu = (rows: LibraryItem[]) => {
    if (rows.length !== 1) return []
    if (selection.isSelected(rows[0].id) && selection.size > 1) return []
    return toContextMenuItems<LibraryItem>(actionsFor(rows[0]))
  }

  // Pagination off: everything is one page, so the footer is count-only ("N items" and the selected count, no page buttons).
  const pagination = paginationEnabled
    ? { page, pageSize, total, onPageChange: setPage, itemLabel: ITEM_LABEL }
    : { page: 1, pageSize: Math.max(1, total), total, onPageChange: noop, itemLabel: ITEM_LABEL, hidePages: true }

  return (
    <>
      <DataTable
        // 16px between the toolbar, the table and the footer (the page leaves 24px under the title).
        className="gap-4"
        toolbar={<LibraryToolbarActions t={toolbar} />}
        filters={<LibraryFiltersButton t={toolbar} />}
        search={{ value: toolbar.search, onChange: (value) => toolbar.update("q", value || null), placeholder: "Search library…" }}
        layoutActions={<LibrarySettingsPopover t={toolbar} compact />}
        containerClassName="relative h-full w-full overflow-auto rounded-md border"
        rows={items}
        getRowId={getItemId}
        columns={COLUMNS}
        tableId={LIBRARY_TABLE_ID}
        layout={layout}
        onLayoutChange={setLayout}
        defaultSort={DEFAULT_LIBRARY_SORT}
        extraSortKeys={EXTRA_SORT_KEYS}
        defaultHiddenWhenUnset
        selection="multi"
        selectionState={selection}
        selectedCount={approxCount}
        // A privacy label: the title stays hashed while the item is blurred and not revealed.
        getRowLabel={(item) => `Select ${item.blurred && !isRevealed(item.id) ? hashText(item.title) : item.title}`}
        contextMenu={contextMenu}
        pagination={pagination}
        loading={isLoading || settingsLoading || !sortReady}
        loadingContent={<ListSkeleton />}
        error={isError ? <p className="text-sm text-destructive">Failed to load library: {(error as Error).message}</p> : undefined}
        empty={
          data && data.total > 0 ? null : (
            <p className="text-sm text-muted-foreground">
              {hasFilters ? "No library items match these filters." : "Nothing here yet. Completed downloads will show up in your library."}
            </p>
          )
        }
      />
      {actionsHost}
    </>
  )
}
