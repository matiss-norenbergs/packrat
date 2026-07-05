import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { fetchHistory, retryHistoryItem } from "@/lib/api"
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
