import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  cancelDownload,
  clearDownloadLog,
  createBatchDownload,
  createDownload,
  createPlaylistDownload,
  bulkDeleteDownloads,
  fetchDownloads,
  previewDownload,
} from "@/lib/api"
import { historyQueryKey } from "@/hooks/useHistory"
import { logsQueryKey } from "@/hooks/useLogs"
import type { CreateBatchDownloadRequest, CreateDownloadRequest, CreatePlaylistDownloadRequest, Download, DownloadStatus } from "@/types/api"

export const downloadsQueryKey = ["downloads"] as const

const DOWNLOADS_REFETCH_MS = 10_000 // safety-net poll; WS pushes deltas in between

export function useDownloads() {
  return useQuery({
    queryKey: downloadsQueryKey,
    queryFn: fetchDownloads,
    refetchInterval: DOWNLOADS_REFETCH_MS,
  })
}

export interface DownloadProgress {
  status: DownloadStatus
  percent: number
}

/** Narrows the downloads list to one download's progress. Exported for tests. */
export function selectDownloadProgress(downloads: Download[], downloadId: number): DownloadProgress | null {
  const d = downloads.find((x) => x.id === downloadId)
  return d ? { status: d.status, percent: d.percent } : null
}

/**
 * Live status/percent of one download, for a Library card. Shares the downloads query (so the socket hook's
 * `progress` patches land in it) but `select` narrows it to `{status, percent}`: the result is structurally
 * shared, so a card re-renders only when its own download changes, not on other downloads' ticks. Mount it
 * only for items that have an active download.
 */
export function useDownloadProgress(downloadId: number) {
  return useQuery({
    queryKey: downloadsQueryKey,
    queryFn: fetchDownloads,
    refetchInterval: DOWNLOADS_REFETCH_MS,
    select: (downloads) => selectDownloadProgress(downloads, downloadId),
  })
}

export function useDownloadPreview(url: string, enabled: boolean) {
  return useQuery({
    queryKey: ["downloads", "preview", url] as const,
    queryFn: () => previewDownload(url),
    enabled: enabled && url.length > 0,
    retry: false, // a bad/unsupported URL is expected, not transient
    staleTime: 30_000,
  })
}

export function useCreateDownload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateDownloadRequest) => createDownload(payload),
    onSuccess: () => {
      toast.success("Download queued")
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to queue download: ${err.message}`)
    },
  })
}

export function useCreatePlaylistDownload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreatePlaylistDownloadRequest) => createPlaylistDownload(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
      queryClient.invalidateQueries({ queryKey: historyQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to queue playlist: ${err.message}`)
    },
  })
}

export function useCreateBatchDownload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateBatchDownloadRequest) => createBatchDownload(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
      queryClient.invalidateQueries({ queryKey: historyQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to queue downloads: ${err.message}`)
    },
  })
}

export function useCancelDownload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => cancelDownload(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to cancel: ${err.message}`)
    },
  })
}

// Deletes the given downloads from the log, all or nothing, in one request — one id for a
// single-row delete. Callers filter out still-active downloads first; if one slips through (it
// started meanwhile) the server answers 409 with a message and deletes nothing, which is shown
// here and leaves the caller's selection alone (it clears it only on success).
export function useBulkDeleteDownloads() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => bulkDeleteDownloads(ids),
    onSuccess: ({ deleted }) => {
      toast.success(`Removed ${deleted} download${deleted === 1 ? "" : "s"}`)
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete: ${err.message}`)
    },
  })
}

export function useClearDownloadLog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => clearDownloadLog(),
    onSuccess: (result) => {
      toast.success(`Deleted ${result.deleted} log ${result.deleted === 1 ? "entry" : "entries"}`)
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
      queryClient.invalidateQueries({ queryKey: logsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to clear download log: ${err.message}`)
    },
  })
}
