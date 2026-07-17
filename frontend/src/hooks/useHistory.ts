import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { clearHistory, deleteHistoryItem, fetchHistory, retryHistoryItem } from "@/lib/api"
import { downloadsQueryKey } from "./useDownloads"

export const historyQueryKey = ["history"] as const

export function useHistory() {
  return useQuery({
    queryKey: historyQueryKey,
    queryFn: fetchHistory,
  })
}

export function useRetryHistoryItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => retryHistoryItem(id),
    onSuccess: () => {
      toast.success("Retry queued")
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
      queryClient.invalidateQueries({ queryKey: historyQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to retry: ${err.message}`)
    },
  })
}

export function useDeleteHistoryItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteHistoryItem(id),
    onSuccess: () => {
      toast.success("Removed")
      queryClient.invalidateQueries({ queryKey: historyQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete: ${err.message}`)
    },
  })
}

export function useClearHistory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => clearHistory(),
    onSuccess: (result) => {
      toast.success(`Deleted ${result.deleted} history ${result.deleted === 1 ? "entry" : "entries"}`)
      queryClient.invalidateQueries({ queryKey: historyQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to clear history: ${err.message}`)
    },
  })
}
