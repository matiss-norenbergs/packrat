import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  bulkDeleteThumbnailEnhancementHistoryEntries,
  bulkDeleteThumbnailOriginals,
  bulkFetchLibraryThumbnails,
  bulkRevertThumbnailOriginals,
  clearThumbnailEnhancementHistory,
  deleteThumbnailEnhancementHistoryEntry,
  deleteThumbnailOriginal,
  enhanceThumbnailItems,
  getThumbnailEnhancementStatus,
  listThumbnailEnhancementEligible,
  listThumbnailEnhancementHistory,
  listThumbnailUpscalers,
  revertThumbnailOriginal,
  runThumbnailEnhancementNow,
  type ThumbnailEnhancementHistoryParams,
} from "@/lib/api"
import { libraryQueryKey } from "./useLibrary"
import type { EnhanceProgressPayload } from "@/types/ws"

export const thumbnailEnhancementHistoryQueryKey = ["thumbnail-enhancement-history"] as const
export const thumbnailEnhancementEligibleQueryKey = ["thumbnail-enhancement-eligible"] as const
// Seeded by useDownloadsSocket's enhance_progress handler, never fetched —
// the "query cache as pub/sub channel" trick, so the page can reactively
// read the currently-processing item without a dedicated state store.
export const thumbnailEnhancementActiveItemQueryKey = ["thumbnail-enhancement-active-item"] as const

export function useThumbnailEnhancementHistory(params: ThumbnailEnhancementHistoryParams = {}) {
  return useQuery({
    queryKey: [...thumbnailEnhancementHistoryQueryKey, params],
    queryFn: () => listThumbnailEnhancementHistory(params),
  })
}

// useThumbnailEnhancementActiveItem is a passive read of the "currently
// processing" cache entry — its queryFn never actually runs, since
// useDownloadsSocket always seeds the cache before this could ever be
// asked to fetch.
export function useThumbnailEnhancementActiveItem() {
  return useQuery<EnhanceProgressPayload | null>({
    queryKey: thumbnailEnhancementActiveItemQueryKey,
    queryFn: () => null,
    initialData: null,
    staleTime: Infinity,
  })
}

export function useRunThumbnailEnhancementNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: runThumbnailEnhancementNow,
    onSuccess: (result) => {
      toast.success(result.queued > 0 ? `Queued ${result.queued} item(s) for enhancement` : "Nothing to enhance right now")
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementEligibleQueryKey })
    },
    onError: (err: Error) => toast.error(`Enhancement run failed: ${err.message}`),
  })
}

// useThumbnailUpscalers is a mutation, not a query — it's triggered
// on-demand by the Settings tab's "Load models" button against whatever
// URL/credentials are currently typed in the form, which may not be saved
// (or even valid) yet, so it can't be a cache-backed query keyed on saved
// settings.
export function useThumbnailUpscalers() {
  return useMutation({
    mutationFn: ({ url, username, password }: { url: string; username: string; password: string }) =>
      listThumbnailUpscalers(url, username, password),
    onError: (err: Error) => toast.error(`Couldn't load upscaler models: ${err.message}`),
  })
}

// useThumbnailEnhancementStatus backs the AI Enhancement page's status
// badge — polled while the page is open (staleTime keeps it from refetching
// on every focus/mount within the window) so the badge doesn't just reflect
// a stale first check if the instance goes up/down mid-session.
export function useThumbnailEnhancementStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["thumbnail-enhancement-status"],
    queryFn: getThumbnailEnhancementStatus,
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

// useThumbnailEnhancementEligible backs the "Preview eligible items" dialog
// — only fetched while the dialog is open (enabled), since it's a
// point-in-time snapshot nobody needs cached in the background.
export function useThumbnailEnhancementEligible(enabled: boolean) {
  return useQuery({
    queryKey: thumbnailEnhancementEligibleQueryKey,
    queryFn: listThumbnailEnhancementEligible,
    enabled,
  })
}

// useEnhanceThumbnailItems backs the eligible-items dialog's toolbar
// "Enhance Selected" button — fire-and-forget, like the "Enhance Now"
// button; live status streams over the enhance_progress WebSocket event
// (see useDownloadsSocket) rather than this mutation's own completion.
export function useEnhanceThumbnailItems() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: enhanceThumbnailItems,
    onSuccess: (result) => {
      toast.success(`Queued ${result.queued} item(s) for enhancement`)
    },
    onError: (err: Error) => toast.error(`Enhancement failed: ${err.message}`),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementEligibleQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
  })
}

export function useRevertThumbnailOriginal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: revertThumbnailOriginal,
    onSuccess: () => {
      toast.success("Reverted to original thumbnail")
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementHistoryQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Revert failed: ${err.message}`),
  })
}

export function useDeleteThumbnailOriginal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteThumbnailOriginal,
    onSuccess: () => {
      toast.success("Original thumbnail deleted")
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementHistoryQueryKey })
    },
    onError: (err: Error) => toast.error(`Delete failed: ${err.message}`),
  })
}

// useBulkDeleteThumbnailOriginals backs the AI Enhancement page's bulk
// "Keep Enhanced" action — takes deduped library-item ids (the page filters
// the selection down to rows with hasOriginalBackup first).
export function useBulkDeleteThumbnailOriginals() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkDeleteThumbnailOriginals,
    onSuccess: (result) => {
      toast.success(
        result.skipped > 0
          ? `Kept ${result.updated} enhanced thumbnail(s), skipped ${result.skipped} with nothing to keep`
          : `Kept ${result.updated} enhanced thumbnail(s)`,
      )
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementHistoryQueryKey })
    },
    onError: (err: Error) => toast.error(`Keep enhanced failed: ${err.message}`),
  })
}

// useBulkRevertThumbnailOriginals backs the AI Enhancement page's bulk
// "Keep Original" action — same input shape as useBulkDeleteThumbnailOriginals.
export function useBulkRevertThumbnailOriginals() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkRevertThumbnailOriginals,
    onSuccess: (result) => {
      toast.success(
        result.skipped > 0
          ? `Restored ${result.updated} original thumbnail(s), skipped ${result.skipped} with nothing to restore`
          : `Restored ${result.updated} original thumbnail(s)`,
      )
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementHistoryQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Keep original failed: ${err.message}`),
  })
}

// useRedownloadThumbnailsFromOriginal backs the AI Enhancement page's bulk
// "Redownload thumb from original" action — reuses the library page's
// existing bulk-fetch-thumbnails endpoint (it already silently skips items
// with no saved source URL), just also invalidating this page's history
// query since a successful fetch clears hasOriginalBackup as a side effect.
export function useRedownloadThumbnailsFromOriginal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (itemIds: number[]) => bulkFetchLibraryThumbnails({ itemIds }),
    onSuccess: (result) => {
      toast.success(
        result.skipped > 0
          ? `Redownloaded ${result.fetched} thumbnail(s), skipped ${result.skipped} with no source URL`
          : `Redownloaded ${result.fetched} thumbnail(s)`,
      )
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementHistoryQueryKey })
    },
    onError: (err: Error) => toast.error(`Redownload failed: ${err.message}`),
  })
}

// useDeleteThumbnailEnhancementHistoryEntry backs the history table's
// per-row delete action. If it was the last row for that item, the backend
// also frees the item's original-thumbnail backup — invalidating history
// alone is enough to reflect that, since hasOriginalBackup is read fresh
// from this same query on every row.
export function useDeleteThumbnailEnhancementHistoryEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteThumbnailEnhancementHistoryEntry,
    onSuccess: () => {
      toast.success("History entry deleted")
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementHistoryQueryKey })
    },
    onError: (err: Error) => toast.error(`Delete failed: ${err.message}`),
  })
}

// useBulkDeleteThumbnailEnhancementHistoryEntries backs the history table's
// toolbar "Delete Selected" action.
export function useBulkDeleteThumbnailEnhancementHistoryEntries() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkDeleteThumbnailEnhancementHistoryEntries,
    onSuccess: (result) => {
      toast.success(`Deleted ${result.deleted} history ${result.deleted === 1 ? "entry" : "entries"}`)
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementHistoryQueryKey })
    },
    onError: (err: Error) => toast.error(`Delete failed: ${err.message}`),
  })
}

export function useClearThumbnailEnhancementHistory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: clearThumbnailEnhancementHistory,
    onSuccess: (result) => {
      toast.success(`Deleted ${result.deleted} history ${result.deleted === 1 ? "entry" : "entries"}`)
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementHistoryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to clear history: ${err.message}`),
  })
}
