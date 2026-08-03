import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Columns3,
  Eye,
  EyeOff,
  FolderTree,
  Info,
  LayoutGrid,
  List,
  Pencil,
  Search,
  Settings,
  SlidersHorizontal,
  Tags,
  X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCollections } from "@/hooks/useCollections"
import { useLibraryFacets } from "@/hooks/useLibrary"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import { useTags } from "@/hooks/useTags"
import { sortCollectionsByPath } from "@/lib/collectionTree"
import type { LibrarySortDir, LibrarySortKey } from "@/lib/libraryFilters"
import { AddToCompareListDialog } from "./AddToCompareListDialog"
import { BulkAssignTagsDialog } from "./BulkAssignTagsDialog"
import { BulkDeleteLibraryItemsDialog } from "./BulkDeleteLibraryItemsDialog"
import { BulkEditLibraryItemsDialog } from "./BulkEditLibraryItemsDialog"
import { BulkSetArtistDialog } from "./BulkSetArtistDialog"
import { BulkSetGenerateNfoDialog } from "./BulkSetGenerateNfoDialog"
import { BulkSetYearDialog } from "./BulkSetYearDialog"
import { EditSequenceDialog } from "./EditSequenceDialog"
import { LIBRARY_COLUMNS, useLibraryColumns } from "./LibraryColumnsContext"
import { useRevealAll } from "./RevealAllContext"
import { useSelection } from "./SelectionContext"

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
const PAGINATION_DISABLED = "disabled"

const NONE = "none"

export function LibraryToolbar() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: collections } = useCollections()
  const { data: facets } = useLibraryFacets()
  const { data: allTags } = useTags()
  // view/sort are DB-backed settings (remembered across reloads and
  // browsers) rather than URL params — q/collection/year stay URL-only
  // since they're per-visit filters, not a "remembered preference," and
  // moving "collection" out of the URL would break the folder view's
  // breadcrumb/browser-back behavior.
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const { revealAll, toggleRevealAll } = useRevealAll()
  const { selectionActive, approxCount, clear } = useSelection()
  const { visibleColumns, toggleColumn } = useLibraryColumns()
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkTagsOpen, setBulkTagsOpen] = useState(false)
  const [bulkArtistOpen, setBulkArtistOpen] = useState(false)
  const [bulkYearOpen, setBulkYearOpen] = useState(false)
  const [bulkNfoOpen, setBulkNfoOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [editSequenceOpen, setEditSequenceOpen] = useState(false)
  const [addToCompareOpen, setAddToCompareOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false)
  // Draft copies of Mode/View/Pagination — same draft-then-Apply idiom as
  // the Filters & Sort dialog below, just surfaced in a Popover instead of a
  // Dialog, so opening the popover doesn't touch anything until Apply.
  const [draftMode, setDraftMode] = useState<"manage" | "details">("manage")
  const [draftView, setDraftView] = useState<"grid" | "folders" | "list">("grid")
  const [draftPagination, setDraftPagination] = useState(PAGINATION_DISABLED)
  // Draft copies of the filter/sort controls that live inside the dialog —
  // edits only touch this local state, so opening the picker doesn't
  // re-filter/re-sort the grid on every click. Applying commits everything
  // in one settings PATCH + one URL update instead of one request per field.
  const [draftSortKey, setDraftSortKey] = useState<LibrarySortKey>("downloadedAt")
  const [draftSortDir, setDraftSortDir] = useState<LibrarySortDir>("desc")
  const [draftCollectionId, setDraftCollectionId] = useState(NONE)
  const [draftYear, setDraftYear] = useState(NONE)
  const [draftTags, setDraftTags] = useState<string[]>([])

  const view =
    settings?.libraryView === "folders" ? "folders" : settings?.libraryView === "list" ? "list" : "grid"
  const mode = (settings?.libraryMode as "manage" | "details") || "manage"
  // Whether anything in the library is currently blurred — either a whole
  // collection (itself or an inherited ancestor) is private and has at
  // least one item somewhere under it, using the inheritance-aware
  // effectiveIsPrivate/totalItemCount fields (a private *parent* used purely
  // for organization has itemCount 0 of its own, with its items living in a
  // non-private child that only inherits — the raw isPrivate/itemCount alone
  // would always read as "nothing blurred" in that normal nested-collection
  // setup) — or a private tag is applied to at least one item, independent
  // of any collection (backend's blurred computation ORs both sources
  // together; this needs to match, or a lone private-tagged item in an
  // otherwise-public collection leaves the reveal button permanently
  // disabled with no way to un-blur it).
  const hasBlurred =
    !!settings?.privacyEnabled &&
    ((collections ?? []).some((c) => c.effectiveIsPrivate && c.totalItemCount > 0) ||
      (allTags ?? []).some((t) => t.isPrivate && t.usageCount > 0))
  const search = searchParams.get("q") ?? ""
  const [searchInput, setSearchInput] = useState(search)
  const sortKey = (settings?.librarySortKey as LibrarySortKey) || "downloadedAt"
  const sortDir: LibrarySortDir = settings?.librarySortDir === "asc" ? "asc" : "desc"
  const collectionId = searchParams.get("collection") ?? NONE
  const year = searchParams.get("year") ?? NONE
  const selectedTags = (searchParams.get("tags") ?? "").split(",").filter(Boolean)
  const paginationEnabled = settings?.libraryPaginationEnabled ?? false
  const pageSize = settings?.libraryPageSize || 48

  const years = facets?.years ?? []
  // Sort isn't counted here — it always has a value, so it wouldn't make a
  // meaningful "N active" indicator the way an unset-by-default filter does.
  const activeFilterCount = (collectionId !== NONE ? 1 : 0) + (year !== NONE ? 1 : 0) + selectedTags.length

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value == null || value === NONE || value === "") next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

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

  const openSettingsPopover = (next: boolean) => {
    if (next) {
      setDraftMode(mode)
      setDraftView(view)
      setDraftPagination(paginationEnabled ? String(pageSize) : PAGINATION_DISABLED)
    }
    setSettingsPopoverOpen(next)
  }

  const applyLibrarySettings = () => {
    const patch: { libraryMode?: string; libraryView?: string; libraryPaginationEnabled?: boolean; libraryPageSize?: number } = {}
    if (draftMode !== mode) patch.libraryMode = draftMode
    if (draftView !== view) patch.libraryView = draftView
    const draftPaginationEnabled = draftPagination !== PAGINATION_DISABLED
    if (draftPaginationEnabled !== paginationEnabled) patch.libraryPaginationEnabled = draftPaginationEnabled
    if (draftPaginationEnabled && Number(draftPagination) !== pageSize) patch.libraryPageSize = Number(draftPagination)
    if (Object.keys(patch).length > 0) updateSettings.mutate(patch)

    // Preserve the two side effects the old per-control setters used to
    // apply immediately on every click — now applied once at commit time.
    if (draftView !== view) {
      // Switching views makes a stale "collection" filter/location ambiguous
      // between the two views' different meanings for that param — clear it.
      const params = new URLSearchParams(searchParams)
      params.delete("collection")
      setSearchParams(params, { replace: true })
    }
    if (draftMode !== mode && draftMode !== "manage") {
      // Leaving manage mode hides every checkbox, so a lingering selection
      // would silently reappear if the user switches back — clear it now.
      clear()
    }

    setSettingsPopoverOpen(false)
  }

  const openFilters = () => {
    setDraftSortKey(sortKey)
    setDraftSortDir(sortDir)
    setDraftCollectionId(collectionId)
    setDraftYear(year)
    setDraftTags(selectedTags)
    setFiltersOpen(true)
  }

  const toggleDraftTag = (name: string) => {
    setDraftTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]))
  }

  const applyFilters = () => {
    if (draftSortKey !== sortKey || draftSortDir !== sortDir) {
      updateSettings.mutate({ librarySortKey: draftSortKey, librarySortDir: draftSortDir })
    }
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of [
      ["collection", draftCollectionId],
      ["year", draftYear],
      ["tags", draftTags.join(",")],
    ] as const) {
      if (value === "" || value === NONE) next.delete(key)
      else next.set(key, value)
    }
    setSearchParams(next, { replace: true })
    setFiltersOpen(false)
  }

  return (
    <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[140px] max-w-[280px] flex-1 sm:min-w-[200px] sm:max-w-[400px]">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search title, uploader, artist, description…"
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
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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

      <Button variant="outline" onClick={openFilters}>
        <SlidersHorizontal className="h-4 w-4" />
        Filters &amp; Sort
        {activeFilterCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground">
            {activeFilterCount}
          </span>
        )}
      </Button>

      {settings?.privacyEnabled && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={revealAll ? "secondary" : "outline"}
              size="icon"
              className="ml-auto"
              disabled={!hasBlurred}
              onClick={toggleRevealAll}
            >
              {revealAll ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{revealAll ? "Hide all private items" : "Reveal all private items"}</TooltipContent>
        </Tooltip>
      )}

      <Popover open={settingsPopoverOpen} onOpenChange={openSettingsPopover}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className={!settings?.privacyEnabled ? "ml-auto" : undefined}
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
    </div>

    {mode === "manage" && (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {selectionActive ? `${approxCount} selected` : "Select files or collections to bulk edit"}
        </span>
        {selectionActive && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!selectionActive}>
              Bulk operations
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            <DropdownMenuItem onSelect={() => setBulkEditOpen(true)}>Edit…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBulkTagsOpen(true)}>Assign tags…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBulkArtistOpen(true)}>Set artist…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBulkYearOpen(true)}>Set year…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBulkNfoOpen(true)}>Generate NFO…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditSequenceOpen(true)}>Edit sequence…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAddToCompareOpen(true)}>Add to compare list…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setBulkDeleteOpen(true)}>
              Delete selected…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <BulkEditLibraryItemsDialog open={bulkEditOpen} onOpenChange={setBulkEditOpen} />
        <BulkAssignTagsDialog open={bulkTagsOpen} onOpenChange={setBulkTagsOpen} />
        <BulkSetArtistDialog open={bulkArtistOpen} onOpenChange={setBulkArtistOpen} />
        <BulkSetYearDialog open={bulkYearOpen} onOpenChange={setBulkYearOpen} />
        <BulkSetGenerateNfoDialog open={bulkNfoOpen} onOpenChange={setBulkNfoOpen} />
        <BulkDeleteLibraryItemsDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen} />
        <EditSequenceDialog open={editSequenceOpen} onOpenChange={setEditSequenceOpen} />
        <AddToCompareListDialog open={addToCompareOpen} onOpenChange={setAddToCompareOpen} />

        {view === "list" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto">
                <Columns3 className="h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {LIBRARY_COLUMNS.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visibleColumns.has(col.key)}
                  onSelect={(e) => {
                    e.preventDefault()
                    toggleColumn(col.key)
                  }}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    )}

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
        </div>
        <DialogFooter>
          <Button onClick={applyFilters}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  )
}
