import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  cancelDownload,
  clearDownloadLog,
  createBatchDownload,
  createDownload,
  createPlaylistDownload,
  deleteDownload,
  fetchDownloads,
  previewDownload,
} from "@/lib/api"
import { historyQueryKey } from "@/hooks/useHistory"
import { logsQueryKey } from "@/hooks/useLogs"
import type { CreateBatchDownloadRequest, CreateDownloadRequest, CreatePlaylistDownloadRequest } from "@/types/api"

export const downloadsQueryKey = ["downloads"] as const

export function useDownloads() {
  return useQuery({
    queryKey: downloadsQueryKey,
    queryFn: fetchDownloads,
    refetchInterval: 10_000, // safety-net poll; WS pushes deltas in between
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

export function useDeleteDownload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteDownload(id),
    onSuccess: () => {
      toast.success("Removed")
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
