import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  acceptLibraryItemTrim,
  bulkAssignTags,
  bulkDeleteLibraryItems,
  deleteLibraryItem,
  deleteLibraryItemNFO,
  discardLibraryItemTrim,
  fetchLibrary,
  fetchLibraryFacets,
  fetchLibraryItemMetadataPreview,
  fetchLibraryItemNFO,
  fetchLibraryItemTrimFrames,
  fetchLibraryQuery,
  fetchLibraryThumbnailCandidates,
  generateLibraryItemNFO,
  moveLibraryItem,
  previewLibraryItemTrim,
  probeLibraryItemMetadata,
  fetchRedownloadPreview,
  quickGrabLibraryThumbnail,
  redownloadLibraryItem,
  redownloadLibraryItemFromUrl,
  redownloadLibraryThumbnail,
  refreshLibraryItemMetadata,
  setLibraryThumbnail,
  updateLibraryItem,
  updateLibraryItemProgress,
} from "@/lib/api"
import type {
  BulkAssignTagsRequest,
  BulkDeleteLibraryItemsRequest,
  LibraryItem,
  LibraryListResponse,
  LibraryQueryParams,
  MoveLibraryItemRequest,
  RedownloadOverwriteField,
  TrimPreviewRequest,
  UpdateLibraryItemRequest,
} from "@/types/api"
import { downloadsQueryKey } from "./useDownloads"
import { tagsQueryKey } from "./useTags"

export const libraryQueryKey = ["library"] as const

// The entire, unfiltered library — only for call sites that genuinely need
// every item (the item detail page's sibling strip). The grid/folder views
// use useLibraryQuery instead.
export function useLibrary() {
  return useQuery({
    queryKey: libraryQueryKey,
    queryFn: fetchLibrary,
  })
}

// Server-side search/filter/sort/(optional) pagination for the Library
// page's grid and folder views — replaces fetching everything and filtering
// client-side. `enabled` defaults to true; BulkAssignTagsDialog passes false
// until it actually opens, so resolving a whole-collection selection doesn't
// fire a query on every checkbox click.
export function useLibraryQuery(params: LibraryQueryParams, enabled = true) {
  return useQuery({
    queryKey: [...libraryQueryKey, "query", params],
    queryFn: () => fetchLibraryQuery(params),
    enabled,
  })
}

// Distinct filter values (currently just years) computed over the whole
// library — used by pickers that need every possible value regardless of
// whatever page/folder/search is currently active.
export function useLibraryFacets() {
  return useQuery({
    queryKey: [...libraryQueryKey, "facets"],
    queryFn: fetchLibraryFacets,
  })
}

export function useDeleteLibraryItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, deleteFiles }: { id: number; deleteFiles: boolean }) => deleteLibraryItem(id, deleteFiles),
    onSuccess: () => {
      toast.success("Removed from library")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      // Deleting the last item carrying a tag drops that tag's usageCount to
      // 0 — the reveal-all button (and the tag picker) need the fresh count.
      queryClient.invalidateQueries({ queryKey: tagsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to delete: ${err.message}`),
  })
}

export function useUpdateLibraryItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateLibraryItemRequest }) => updateLibraryItem(id, payload),
    onSuccess: () => {
      toast.success("Saved")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      // The edit dialog's tags field can add/remove tags on this item,
      // changing usageCount — the reveal-all button (and the tag picker)
      // need the fresh count, not just this one item's own blurred flag.
      queryClient.invalidateQueries({ queryKey: tagsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to save: ${err.message}`),
  })
}

// Fires every few seconds during video playback (see usePlaybackProgress),
// so unlike the other mutations here it deliberately skips the toast and
// invalidateQueries — a toast per autosave would be obnoxious, and
// invalidating the whole library list on every tick would force refetches
// while the same item is still playing. Patching the cached list directly
// keeps the Browse page's "Continue Watching" row correct next time it
// mounts without any of that.
export function useUpdateLibraryProgress() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, positionSeconds }: { id: number; positionSeconds: number }) =>
      updateLibraryItemProgress(id, { positionSeconds }),
    onSuccess: (_data, { id, positionSeconds }) => {
      const lastWatchedAt = new Date().toISOString()
      const patch = (item: LibraryItem) =>
        item.id === id ? { ...item, playbackPositionSeconds: positionSeconds, lastWatchedAt } : item
      // Exact-match setQueryData for the bare LibraryItem[] shape (useLibrary).
      queryClient.setQueryData<LibraryItem[]>(libraryQueryKey, (old) => old?.map(patch))
      // Prefix-match setQueriesData for every useLibraryQuery cache entry
      // (LibraryListResponse shape, e.g. Browse's Continue Watching row) —
      // scoped to the "query" sub-key specifically so this doesn't also try
      // (and fail) to patch differently-shaped entries like
      // useLibraryItemNFO's, which share the "library" key prefix too.
      queryClient.setQueriesData<LibraryListResponse>({ queryKey: [...libraryQueryKey, "query"] }, (old) =>
        old ? { ...old, items: old.items.map(patch) } : old,
      )
    },
  })
}

export function useBulkAssignTags() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: BulkAssignTagsRequest) => bulkAssignTags(payload),
    onSuccess: (_data, payload) => {
      toast.success(`Tags updated on ${payload.itemIds.length} ${payload.itemIds.length === 1 ? "file" : "files"}`)
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: tagsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to update tags: ${err.message}`),
  })
}

export function useBulkDeleteLibraryItems() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: BulkDeleteLibraryItemsRequest) => bulkDeleteLibraryItems(payload),
    onSuccess: (result) => {
      toast.success(`Deleted ${result.deleted} ${result.deleted === 1 ? "file" : "files"}`)
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: tagsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to delete: ${err.message}`),
  })
}

export function useMoveLibraryItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: MoveLibraryItemRequest }) => moveLibraryItem(id, payload),
    onSuccess: () => {
      toast.success("Moved")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to move: ${err.message}`),
  })
}

export function useRefreshLibraryItemMetadata() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => refreshLibraryItemMetadata(id),
    onSuccess: () => {
      toast.success("Metadata refreshed")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to refresh metadata: ${err.message}`),
  })
}

// Read-only ffprobe pass over the item's actual file — no query invalidation
// needed since nothing is persisted; the caller decides what to do with the
// result (EditLibraryItemDialog's rescan-confirm prompt).
export function useProbeLibraryItemMetadata() {
  return useMutation({
    mutationFn: (id: number) => probeLibraryItemMetadata(id),
    onError: (err: Error) => toast.error(`Failed to rescan file: ${err.message}`),
  })
}

// Generates a trimmed preview file — nothing persisted, no query
// invalidation needed. The caller (TrimLibraryItemDialog) holds onto the
// result to drive the Original/Preview playback toggle and the Accept step.
export function usePreviewLibraryItemTrim() {
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: TrimPreviewRequest }) => previewLibraryItemTrim(id, payload),
    onError: (err: Error) => toast.error(`Failed to generate trim preview: ${err.message}`),
  })
}

export function useAcceptLibraryItemTrim() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, previewPath }: { id: number; previewPath: string }) => acceptLibraryItemTrim(id, previewPath),
    onSuccess: () => {
      toast.success("Trim applied")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to apply trim: ${err.message}`),
  })
}

// No success toast/query invalidation — this also fires silently (fire and
// forget) when the dialog closes without an explicit Accept, and nothing
// persisted actually changed for either case.
export function useDiscardLibraryItemTrim() {
  return useMutation({
    mutationFn: ({ id, previewPath }: { id: number; previewPath: string }) => discardLibraryItemTrim(id, previewPath),
    onError: (err: Error) => toast.error(`Failed to discard trim preview: ${err.message}`),
  })
}

// On-demand, not a query keyed on the window — the [start, end) window
// changes continuously as the user adjusts the trim points, so there's no
// stable cache key worth keying a useQuery on. Fired only when the frame
// picker dialog opens for a given boundary.
export function useLibraryItemTrimFrames() {
  return useMutation({
    mutationFn: ({ id, start, end }: { id: number; start: number; end: number }) => fetchLibraryItemTrimFrames(id, start, end),
    onError: (err: Error) => toast.error(`Failed to load frames: ${err.message}`),
  })
}

export function useRedownloadLibraryItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => redownloadLibraryItem(id),
    onSuccess: () => {
      toast.success("Redownload queued")
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to redownload: ${err.message}`),
  })
}

// On-demand, not a query — the candidate URL changes per keystroke/submit
// in the Redownload-from-different-URL dialog, so there's no stable cache
// key worth using (same precedent as useLibraryItemTrimFrames).
export function useRedownloadPreview() {
  return useMutation({
    mutationFn: ({ id, url }: { id: number; url: string }) => fetchRedownloadPreview(id, url),
    onError: (err: Error) => toast.error(`Failed to load preview: ${err.message}`),
  })
}

export function useRedownloadLibraryItemFromUrl() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, url, overwriteFields }: { id: number; url: string; overwriteFields: RedownloadOverwriteField[] }) =>
      redownloadLibraryItemFromUrl(id, url, overwriteFields),
    onSuccess: () => {
      toast.success("Redownload queued")
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to redownload: ${err.message}`),
  })
}

export function useRedownloadLibraryThumbnail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => redownloadLibraryThumbnail(id),
    onSuccess: () => {
      toast.success("Thumbnail redownloaded")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to redownload thumbnail: ${err.message}`),
  })
}

export function useQuickGrabLibraryThumbnail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => quickGrabLibraryThumbnail(id),
    onSuccess: () => {
      toast.success("Thumbnail grabbed")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to grab thumbnail: ${err.message}`),
  })
}

export function useLibraryThumbnailCandidates(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ["library", id, "thumbnail-candidates"],
    queryFn: () => fetchLibraryThumbnailCandidates(id),
    enabled,
    staleTime: 0,
    gcTime: 0,
  })
}

export function useLibraryItemMetadataPreview(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ["library", id, "metadata-preview"],
    queryFn: () => fetchLibraryItemMetadataPreview(id),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

export function useGenerateLibraryItemNFO() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => generateLibraryItemNFO(id),
    onSuccess: (_data, id) => {
      toast.success("NFO file generated")
      // nfoExists on the library list is now stale, and the content dialog
      // (if it's ever reopened) shouldn't serve a cached pre-generation
      // 404/old body.
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: ["library", id, "nfo"] })
    },
    onError: (err: Error) => toast.error(`Failed to generate NFO: ${err.message}`),
  })
}

export function useLibraryItemNFO(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ["library", id, "nfo"],
    queryFn: () => fetchLibraryItemNFO(id),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

export function useDeleteLibraryItemNFO() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteLibraryItemNFO(id),
    onSuccess: (_data, id) => {
      toast.success("NFO file deleted")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: ["library", id, "nfo"] })
    },
    onError: (err: Error) => toast.error(`Failed to delete NFO file: ${err.message}`),
  })
}

export function useSetLibraryThumbnail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, imageBase64 }: { id: number; imageBase64: string }) => setLibraryThumbnail(id, imageBase64),
    onSuccess: () => {
      toast.success("Thumbnail updated")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to set thumbnail: ${err.message}`),
  })
}
