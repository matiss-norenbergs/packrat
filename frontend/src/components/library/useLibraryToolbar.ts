import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useCollections } from "@/hooks/useCollections"
import { useLibraryFacets } from "@/hooks/useLibrary"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import { useLibrarySort } from "@/hooks/useLibrarySort"
import { useTags } from "@/hooks/useTags"
import { useFeatureEnabled } from "@/hooks/useFeature"
import type { LibrarySortDir, LibrarySortKey } from "@/lib/libraryFilters"
import type { FrameMatchMode } from "@/types/api"
import { useSelection } from "./SelectionContext"

export const PAGINATION_DISABLED = "disabled"
export const NONE = "none"

/**
 * All state and handlers of the Library toolbar (bulk dialogs, the Filters & Sort draft, the display settings draft, the
 * URL filters). The classic toolbar and the list view each call it once and hand it to the pieces below.
 */
export function useLibraryToolbar() {
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
  const compareListEnabled = useFeatureEnabled("featureCompareListEnabled")
  const frameMatchingEnabled = useFeatureEnabled("featureFrameMatchingEnabled")
  const updateSettings = useUpdateSettings()
  const { selectionActive, approxCount, clear } = useSelection()
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkTagsOpen, setBulkTagsOpen] = useState(false)
  const [bulkArtistOpen, setBulkArtistOpen] = useState(false)
  const [bulkYearOpen, setBulkYearOpen] = useState(false)
  const [bulkNfoOpen, setBulkNfoOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleteFileOpen, setBulkDeleteFileOpen] = useState(false)
  const [bulkRedownloadOpen, setBulkRedownloadOpen] = useState(false)
  const [bulkFetchThumbnailsOpen, setBulkFetchThumbnailsOpen] = useState(false)
  const [bulkFrameMatchMode, setBulkFrameMatchMode] = useState<FrameMatchMode | null>(null)
  const [bulkSharpenOpen, setBulkSharpenOpen] = useState(false)
  const [editSequenceOpen, setEditSequenceOpen] = useState(false)
  const [addToCompareOpen, setAddToCompareOpen] = useState(false)
  const [addGhostOpen, setAddGhostOpen] = useState(false)
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
  const [draftHideGhosts, setDraftHideGhosts] = useState(false)

  const view =
    settings?.libraryView === "folders" ? "folders" : settings?.libraryView === "list" ? "list" : "grid"
  const mode = (settings?.libraryMode as "manage" | "details") || "manage"
  const search = searchParams.get("q") ?? ""
  const { sort, baseline: baselineSort, setSort, saveSortAsDefault } = useLibrarySort()
  const { key: sortKey, dir: sortDir } = sort
  const collectionId = searchParams.get("collection") ?? NONE
  const year = searchParams.get("year") ?? NONE
  const selectedTags = (searchParams.get("tags") ?? "").split(",").filter(Boolean)
  const hideGhosts = searchParams.get("hideGhosts") === "true"
  const paginationEnabled = settings?.libraryPaginationEnabled ?? false
  const pageSize = settings?.libraryPageSize || 48

  const years = facets?.years ?? []
  // Sort isn't counted here — it always has a value, so it wouldn't make a
  // meaningful "N active" indicator the way an unset-by-default filter does.
  const activeFilterCount =
    (collectionId !== NONE ? 1 : 0) + (year !== NONE ? 1 : 0) + selectedTags.length + (hideGhosts ? 1 : 0)

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value == null || value === NONE || value === "") next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

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
    setDraftHideGhosts(hideGhosts)
    setFiltersOpen(true)
  }

  const toggleDraftTag = (name: string) => {
    setDraftTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]))
  }

  const draftSortDiffersFromBaseline = draftSortKey !== baselineSort.key || draftSortDir !== baselineSort.dir

  const applyFilters = (saveSort = false) => {
    if (draftSortKey !== sortKey || draftSortDir !== sortDir) {
      setSort({ key: draftSortKey, dir: draftSortDir })
    }
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of [
      ["collection", draftCollectionId],
      ["year", draftYear],
      ["tags", draftTags.join(",")],
      ["hideGhosts", draftHideGhosts ? "true" : ""],
    ] as const) {
      if (value === "" || value === NONE) next.delete(key)
      else next.set(key, value)
    }
    setSearchParams(next, { replace: true })
    setFiltersOpen(false)
    if (saveSort) void saveSortAsDefault({ key: draftSortKey, dir: draftSortDir })
  }
  return {
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
    settingsPopoverOpen,
    openSettingsPopover,
    draftMode,
    setDraftMode,
    draftView,
    setDraftView,
    draftPagination,
    setDraftPagination,
    applyLibrarySettings,
    search,
    update,
  }
}

export type LibraryToolbarState = ReturnType<typeof useLibraryToolbar>

