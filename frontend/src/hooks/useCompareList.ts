import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { addToCompareList, clearCompareList, fetchCompareList, removeFromCompareList } from "@/lib/api"
import type { AddToCompareListRequest } from "@/types/api"

export const compareListQueryKey = ["compare-list"] as const

// enabled: false skips the fetch — callers that sit outside the Compare list
// page (the Library item menu) pass the feature flag, since the endpoint
// rejects requests while the feature is off.
export function useCompareList({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: compareListQueryKey,
    queryFn: fetchCompareList,
    enabled,
  })
}

export function useAddToCompareList() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: AddToCompareListRequest) => addToCompareList(payload),
    onSuccess: (_data, payload) => {
      toast.success(`Added ${payload.itemIds.length} ${payload.itemIds.length === 1 ? "file" : "files"} to compare list`)
      queryClient.invalidateQueries({ queryKey: compareListQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to add to compare list: ${err.message}`),
  })
}

export function useRemoveFromCompareList() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => removeFromCompareList(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: compareListQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to remove from compare list: ${err.message}`),
  })
}

export function useClearCompareList() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => clearCompareList(),
    onSuccess: () => {
      toast.success("Compare list cleared")
      queryClient.invalidateQueries({ queryKey: compareListQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to clear compare list: ${err.message}`),
  })
}
