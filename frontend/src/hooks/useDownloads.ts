import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { cancelDownload, createDownload, deleteDownload, fetchDownloads } from "@/lib/api"
import type { CreateDownloadRequest } from "@/types/api"

export const downloadsQueryKey = ["downloads"] as const

export function useDownloads() {
  return useQuery({
    queryKey: downloadsQueryKey,
    queryFn: fetchDownloads,
    refetchInterval: 10_000, // safety-net poll; WS pushes deltas in between
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
