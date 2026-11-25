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
import { pollWhileSocketDown, useSocketOpen } from "@/lib/socketState"
import { historyQueryKey } from "@/hooks/useHistory"
import { logsQueryKey } from "@/hooks/useLogs"
import type { CreateBatchDownloadRequest, CreateDownloadRequest, CreatePlaylistDownloadRequest, DownloadStatus } from "@/types/api"

import { downloadsQueryKey } from "@/lib/queryKeys"

export { downloadsQueryKey }

// Previews run yt-dlp on the server (POST /downloads/preview), so they live under their own root:
// invalidating ["downloads"] (every queue_update/completed/failed socket event does) matches by
// prefix and would re-run yt-dlp for every open preview. Nothing but the URL changing may refetch one.
export const downloadPreviewQueryKey = (url: string) => ["download-preview", url] as const

const DOWNLOADS_REFETCH_MS = 10_000 // safety-net poll, only while the socket is down; WS pushes deltas otherwise

export function useDownloads() {
  const socketOpen = useSocketOpen()
  return useQuery({
    queryKey: downloadsQueryKey,
    queryFn: ({ signal }) => fetchDownloads(signal),
    refetchInterval: pollWhileSocketDown(DOWNLOADS_REFETCH_MS, socketOpen),
  })
}

export interface DownloadProgress {
  status: DownloadStatus
  percent: number
}

// Live status/percent per download id, written only by the socket's `progress`/`completed`/`failed`
// events (and emptied when it (re)connects). It is its own cache entry, not a slice of the whole
// downloads table: a Library card only needs one percentage, and `GET /api/downloads` returns every
// download ever made. Not under ["downloads"], so a downloads invalidation never touches it.
export const downloadProgressQueryKey = ["download-progress"] as const
export type DownloadProgressMap = Record<number, DownloadProgress>

/** Narrows the live progress map to one download's progress. Exported for tests. */
export function selectDownloadProgress(progress: DownloadProgressMap, downloadId: number): DownloadProgress | null {
  return progress[downloadId] ?? null
}

/**
 * Live status/percent of one download, for a Library card. Reads the socket-fed progress map (no
 * request of its own); `select` narrows it to `{status, percent}` and the result is structurally
 * shared, so a card re-renders only when its own download changes, not on other downloads' ticks.
 * Shows nothing until the first progress event arrives (about a second). Mount it only for items that
 * have an active download.
 */
export function useDownloadProgress(downloadId: number) {
  return useQuery<DownloadProgressMap, Error, DownloadProgress | null>({
    queryKey: downloadProgressQueryKey,
    queryFn: () => ({}), // never runs: the entry is seeded and only the socket writes to it
    initialData: {},
    enabled: false,
    select: (progress) => selectDownloadProgress(progress, downloadId),
  })
}

export function useDownloadPreview(url: string, enabled: boolean) {
  return useQuery({
    queryKey: downloadPreviewQueryKey(url),
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
