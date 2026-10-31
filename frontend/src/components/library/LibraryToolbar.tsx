import { useEffect, useState } from "react"
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Calendar,
  Download,
  FileImage,
  FilePlus2,
  FileX,
  FolderTree,
  GitCompare,
  Info,
  LayoutGrid,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Trash2,
  User,
  X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { sortCollectionsByPath } from "@/lib/collectionTree"
import type { LibrarySortKey } from "@/lib/libraryFilters"
import { AddGhostLibraryItemDialog } from "./AddGhostLibraryItemDialog"
import { AddToCompareListDialog } from "./AddToCompareListDialog"
import { BulkAssignTagsDialog } from "./BulkAssignTagsDialog"
import { BulkDeleteLibraryItemFilesDialog } from "./BulkDeleteLibraryItemFilesDialog"
import { BulkDeleteLibraryItemsDialog } from "./BulkDeleteLibraryItemsDialog"
import { BulkEditLibraryItemsDialog } from "./BulkEditLibraryItemsDialog"
import { BulkFetchLibraryThumbnailsDialog } from "./BulkFetchLibraryThumbnailsDialog"
import { BulkFrameMatchDialog } from "./BulkFrameMatchDialog"
import { BulkRedownloadLibraryItemsDialog } from "./BulkRedownloadLibraryItemsDialog"
import { BulkSetArtistDialog } from "./BulkSetArtistDialog"
import { BulkSetGenerateNfoDialog } from "./BulkSetGenerateNfoDialog"
import { BulkSetYearDialog } from "./BulkSetYearDialog"
import { BulkSharpenThumbnailsDialog } from "./BulkSharpenThumbnailsDialog"
import { EditSequenceDialog } from "./EditSequenceDialog"
import { NONE, PAGINATION_DISABLED, type LibraryToolbarState, useLibraryToolbar } from "./useLibraryToolbar"

const SORT_OPTIONS: { value: LibrarySortKey; label: string }[] = [
  { value: "downloadedAt", label: "Date downloaded" },
  { value: "title", label: "Title" },
  { value: "filename", label: "Filename" },
  { value: "year", label: "Year" },
  { value: "duration", label: "Duration" },
  { value: "sequenceNumber", label: "Sequence #" },
  { value: "seasonNumber", label: "Season & Episode" },
]

const PAGE_SIZE_OPTIONS = [24, 48, 96, 200]

/**
 * Add item, Bulk operations (+ its dialogs), Clear and "N selected": the left side of the toolbar. Used by the classic
 * sticky toolbar (grid, folders) and by the list view's DataTable `toolbar` slot; never both at once.
 */
export function LibraryToolbarActions({ t }: { t: LibraryToolbarState }) {
  const {
    addGhostOpen,
    setAddGhostOpen,
    selectionActive,
    approxCount,
    clear,
    bulkEditOpen,
    setBulkEditOpen,
    bulkTagsOpen,
    setBulkTagsOpen,
    bulkArtistOpen,
    setBulkArtistOpen,
    bulkYearOpen,
    setBulkYearOpen,
    bulkNfoOpen,
    setBulkNfoOpen,
    bulkDeleteOpen,
    setBulkDeleteOpen,
    bulkDeleteFileOpen,
    setBulkDeleteFileOpen,
    bulkRedownloadOpen,
    setBulkRedownloadOpen,
    bulkFetchThumbnailsOpen,
    setBulkFetchThumbnailsOpen,
    bulkFrameMatchMode,
    setBulkFrameMatchMode,
    bulkSharpenOpen,
    setBulkSharpenOpen,
    editSequenceOpen,
    setEditSequenceOpen,
    addToCompareOpen,
    setAddToCompareOpen,
    compareListEnabled,
    frameMatchingEnabled,
    settings,
  } = t
  return (
    <>
        <Button size="sm" onClick={() => setAddGhostOpen(true)}>
          <Plus className="h-4 w-4" />
          Add item
        </Button>
        <AddGhostLibraryItemDialog open={addGhostOpen} onOpenChange={setAddGhostOpen} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!selectionActive}>
              <ListChecks className="h-4 w-4" />
              Bulk operations
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            <DropdownMenuItem onSelect={() => setBulkEditOpen(true)}>
              <Pencil /> Edit…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBulkTagsOpen(true)}>
              <Tags /> Assign tags…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBulkArtistOpen(true)}>
              <User /> Set artist…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBulkYearOpen(true)}>
              <Calendar /> Set year…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBulkNfoOpen(true)}>
              <FilePlus2 /> Generate NFO…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditSequenceOpen(true)}>
              <ListOrdered /> Edit sequence…
            </DropdownMenuItem>
            {compareListEnabled && (
              <DropdownMenuItem onSelect={() => setAddToCompareOpen(true)}>
                <GitCompare /> Add to compare list…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setBulkRedownloadOpen(true)}>
              <Download /> Download file(s)…
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FileImage /> Thumbnail
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => setBulkFetchThumbnailsOpen(true)}>
                  <Download /> Download thumbnail(s)…
                </DropdownMenuItem>
                {frameMatchingEnabled && (
                  <>
                    <DropdownMenuItem onSelect={() => setBulkFrameMatchMode("url")}>
                      <Link2 /> Match from URL thumbnail…
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setBulkFrameMatchMode("current")}>
                      <RefreshCw /> Match from current thumbnail…
                    </DropdownMenuItem>
                  </>
                )}
                {settings?.thumbnailEnhancementEnabled && (
                  <DropdownMenuItem onSelect={() => setBulkSharpenOpen(true)}>
                    <Sparkles /> Sharpen thumbnail(s)…
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setBulkDeleteFileOpen(true)}>
              <FileX /> Delete file…
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setBulkDeleteOpen(true)}>
              <Trash2 /> Delete selected…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <BulkEditLibraryItemsDialog open={bulkEditOpen} onOpenChange={setBulkEditOpen} />
        <BulkAssignTagsDialog open={bulkTagsOpen} onOpenChange={setBulkTagsOpen} />
        <BulkSetArtistDialog open={bulkArtistOpen} onOpenChange={setBulkArtistOpen} />
        <BulkSetYearDialog open={bulkYearOpen} onOpenChange={setBulkYearOpen} />
        <BulkSetGenerateNfoDialog open={bulkNfoOpen} onOpenChange={setBulkNfoOpen} />
        <BulkRedownloadLibraryItemsDialog open={bulkRedownloadOpen} onOpenChange={setBulkRedownloadOpen} />
        <BulkFetchLibraryThumbnailsDialog open={bulkFetchThumbnailsOpen} onOpenChange={setBulkFetchThumbnailsOpen} />
        {frameMatchingEnabled && bulkFrameMatchMode && (
          <BulkFrameMatchDialog
            mode={bulkFrameMatchMode}
            open={bulkFrameMatchMode != null}
            onOpenChange={(open) => !open && setBulkFrameMatchMode(null)}
          />
        )}
        <BulkSharpenThumbnailsDialog open={bulkSharpenOpen} onOpenChange={setBulkSharpenOpen} />
        <BulkDeleteLibraryItemFilesDialog open={bulkDeleteFileOpen} onOpenChange={setBulkDeleteFileOpen} />
        <BulkDeleteLibraryItemsDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen} />
        <EditSequenceDialog open={editSequenceOpen} onOpenChange={setEditSequenceOpen} />
        {compareListEnabled && <AddToCompareListDialog open={addToCompareOpen} onOpenChange={setAddToCompareOpen} />}

        {selectionActive && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        )}
      {selectionActive && <span className="text-sm text-muted-foreground">{approxCount} selected</span>}
    </>
  )
}

/** The "Filters & Sort" button and its draft / Apply / Save as default dialog. */
export function LibraryFiltersButton({ t, className }: { t: LibraryToolbarState; className?: string }) {
  const {
    filtersOpen,
    setFiltersOpen,
    openFilters,
    activeFilterCount,
    view,
    draftSortKey,
    setDraftSortKey,
    draftSortDir,
    setDraftSortDir,
    draftCollectionId,
    setDraftCollectionId,
    draftYear,
    setDraftYear,
    draftTags,
    draftHideGhosts,
    setDraftHideGhosts,
    collections,
    years,
    allTags,
    toggleDraftTag,
    draftSortDiffersFromBaseline,
    applyFilters,
  } = t
  return (
    <>
      <Button variant="outline" className={className} onClick={openFilters}>
        <SlidersHorizontal className="h-4 w-4" />
        Filters &amp; Sort
        {activeFilterCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground">
            {activeFilterCount}
          </span>
        )}
      </Button>

    <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Filters &amp; Sort</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Sort by</Label>
            <div className="flex gap-2">
              <Select value={draftSortKey} onValueChange={(v) => setDraftSortKey(v as LibrarySortKey)}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setDraftSortDir(draftSortDir === "asc" ? "desc" : "asc")}
                  >
                    {draftSortDir === "asc" ? <ArrowUpAZ className="h-4 w-4" /> : <ArrowDownAZ className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{draftSortDir === "asc" ? "Ascending" : "Descending"}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {(view === "grid" || view === "list") && (
            <div className="space-y-2">
              <Label>Collection</Label>
              <Select value={draftCollectionId} onValueChange={setDraftCollectionId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Collection" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>All collections</SelectItem>
                  <SelectSeparator />
                  {sortCollectionsByPath(collections ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Year</Label>
            <Select value={draftYear} onValueChange={setDraftYear}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                  <Tags className="h-4 w-4" />
                  {draftTags.length > 0 ? `Tags (${draftTags.length})` : "Tags"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
                {(allTags ?? []).length === 0 ? (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">No tags yet</p>
                ) : (
                  allTags?.map((tag) => (
                    <DropdownMenuCheckboxItem
                      key={tag.id}
                      checked={draftTags.includes(tag.name)}
                      onSelect={(e) => {
                        e.preventDefault()
                        toggleDraftTag(tag.name)
                      }}
                    >
                      {tag.name}
                    </DropdownMenuCheckboxItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-1.5">
            <Checkbox
              id="library-filters-hide-ghosts"
              checked={draftHideGhosts}
              onCheckedChange={(v) => setDraftHideGhosts(v === true)}
            />
            <Label htmlFor="library-filters-hide-ghosts" className="font-normal">
              Hide ghost items
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={!draftSortDiffersFromBaseline} onClick={() => applyFilters(true)}>
            Save as default
          </Button>
          <Button onClick={() => applyFilters()}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

/** The display settings cog (Mode / View / Pagination, draft then Apply). `compact` is the size of a table toolbar's group buttons. */
export function LibrarySettingsPopover({ t, compact = false }: { t: LibraryToolbarState; compact?: boolean }) {
  const {
    settingsPopoverOpen,
    openSettingsPopover,
    draftMode,
    setDraftMode,
    draftView,
    setDraftView,
    draftPagination,
    setDraftPagination,
    applyLibrarySettings,
  } = t
  return (
      <Popover open={settingsPopoverOpen} onOpenChange={openSettingsPopover}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={compact ? "icon-sm" : "icon"}
            aria-label="Library display settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Mode</Label>
            <div className="flex gap-1 rounded-md border p-0.5">
              <Button
                type="button"
                variant={draftMode === "manage" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => setDraftMode("manage")}
              >
                <Pencil className="h-3.5 w-3.5" />
                Manage
              </Button>
              <Button
                type="button"
                variant={draftMode === "details" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => setDraftMode("details")}
              >
                <Info className="h-3.5 w-3.5" />
                Details
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">View</Label>
            <div className="flex gap-1 rounded-md border p-0.5">
              <Button
                type="button"
                variant={draftView === "grid" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => setDraftView("grid")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Grid
              </Button>
              <Button
                type="button"
                variant={draftView === "folders" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => setDraftView("folders")}
              >
                <FolderTree className="h-3.5 w-3.5" />
                Folders
              </Button>
              <Button
                type="button"
                variant={draftView === "list" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => setDraftView("list")}
              >
                <List className="h-3.5 w-3.5" />
                List
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="library-settings-pagination" className="text-xs text-muted-foreground">
              Pagination
            </Label>
            <Select value={draftPagination} onValueChange={setDraftPagination}>
              <SelectTrigger id="library-settings-pagination" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PAGINATION_DISABLED}>Disabled</SelectItem>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}/page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button className="w-full" size="sm" onClick={applyLibrarySettings}>
            Apply
          </Button>
        </PopoverContent>
      </Popover>
  )
}

export function LibraryToolbar() {
  const t = useLibraryToolbar()
  const { search, update } = t
  const [searchInput, setSearchInput] = useState(search)

  // Keep the input in sync when "q" changes from outside this component
  // (e.g. browser back/forward) without fighting the debounce below.
  useEffect(() => {
    setSearchInput(search)
  }, [search])

  // Debounce pushing keystrokes into the URL param that actually drives
  // filtering — updating on every keystroke re-filters the whole grid each
  // time, which feels janky while typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) update("q", searchInput || null)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <LibraryToolbarActions t={t} />
      <LibraryFiltersButton t={t} className="ml-auto" />

      <div className="relative min-w-[160px] max-w-[280px] flex-1 sm:min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search library…"
          className="pl-8 pr-7"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        {searchInput && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute right-1 inset-y-0 my-auto text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearchInput("")
                  update("q", null)
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear search</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="h-6 w-px bg-border" />

      <LibrarySettingsPopover t={t} />
    </div>
  )
}
