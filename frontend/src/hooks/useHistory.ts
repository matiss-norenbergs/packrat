import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { bulkDeleteHistory, bulkRetryHistory, clearHistory, fetchHistory } from "@/lib/api"
import { downloadsQueryKey } from "./useDownloads"

export const historyQueryKey = ["history"] as const

export function useHistory() {
  return useQuery({
    queryKey: historyQueryKey,
    queryFn: fetchHistory,
  })
}

// Deletes the given history entries in one all-or-nothing request (one id for a single row).
export function useBulkDeleteHistoryItems() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => bulkDeleteHistory(ids),
    onSuccess: ({ deleted }) => {
      toast.success(`Deleted ${deleted} history ${deleted === 1 ? "entry" : "entries"}`)
      queryClient.invalidateQueries({ queryKey: historyQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete: ${err.message}`)
    },
  })
}

// Retries the given entries (one id for a single row). Every entry is handled on its own, so a
// request that went through can still report failures: those get their own toast with the
// first message the server gave.
export function useBulkRetryHistoryItems() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => bulkRetryHistory(ids),
    onSuccess: ({ results, succeeded, failed }) => {
      if (succeeded > 0) toast.success(`${succeeded} ${succeeded === 1 ? "retry" : "retries"} queued`)
      if (failed > 0) {
        const first = results.find((r) => !r.ok)?.error
        toast.error(`${failed} ${failed === 1 ? "retry" : "retries"} failed${first ? `: ${first}` : ""}`)
      }
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
      queryClient.invalidateQueries({ queryKey: historyQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to retry: ${err.message}`)
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
