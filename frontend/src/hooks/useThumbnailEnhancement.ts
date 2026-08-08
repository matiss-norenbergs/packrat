import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  clearThumbnailEnhancementHistory,
  deleteThumbnailEnhancementHistoryEntry,
  deleteThumbnailOriginal,
  enhanceThumbnailItem,
  getThumbnailEnhancementStatus,
  listThumbnailEnhancementEligible,
  listThumbnailEnhancementHistory,
  listThumbnailUpscalers,
  revertThumbnailOriginal,
  runThumbnailEnhancementNow,
} from "@/lib/api"
import { libraryQueryKey } from "./useLibrary"

export const thumbnailEnhancementHistoryQueryKey = ["thumbnail-enhancement-history"] as const
export const thumbnailEnhancementEligibleQueryKey = ["thumbnail-enhancement-eligible"] as const

export function useThumbnailEnhancementHistory() {
  return useQuery({
    queryKey: thumbnailEnhancementHistoryQueryKey,
    queryFn: listThumbnailEnhancementHistory,
  })
}

export function useRunThumbnailEnhancementNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: runThumbnailEnhancementNow,
    onSuccess: (result) => {
      toast.success(result.enhanced > 0 ? `Enhanced ${result.enhanced} thumbnail(s)` : "Nothing to enhance right now")
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementHistoryQueryKey })
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementEligibleQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
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

// useEnhanceThumbnailItem backs the eligible-items dialog's per-row
// "Enhance" button — the item leaves the eligible list once enhanced, so
// that query is invalidated too, not just history/library.
export function useEnhanceThumbnailItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: enhanceThumbnailItem,
    onSuccess: () => {
      toast.success("Thumbnail enhanced")
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementHistoryQueryKey })
      queryClient.invalidateQueries({ queryKey: thumbnailEnhancementEligibleQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Enhancement failed: ${err.message}`),
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
