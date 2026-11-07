import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { deleteSystemEvents, fetchSystemEventFacets, fetchSystemEvents } from "@/lib/api"
import type { DeleteSystemEventsRequest, SystemEventQuery } from "@/types/api"

export const systemEventsQueryKey = ["system-events"] as const
export const systemEventFacetsQueryKey = ["system-events", "facets"] as const

/** One page of the system log; the filters, sort and page are all part of the key (the server does the work). */
export function useSystemEvents(query: SystemEventQuery, enabled = true) {
  return useQuery({
    queryKey: [...systemEventsQueryKey, "list", query] as const,
    queryFn: () => fetchSystemEvents(query),
    enabled,
    // Keeps the previous page on screen while the next one loads, so a filter change doesn't flash the skeleton.
    placeholderData: keepPreviousData,
  })
}

/** The levels / categories present with their counts (all stored events), for the filter dropdowns and the settings card. */
export function useSystemEventFacets(enabled = true) {
  return useQuery({
    queryKey: systemEventFacetsQueryKey,
    queryFn: fetchSystemEventFacets,
    enabled,
  })
}

/** Deletes events by id or clears the log; refetches the list and the facets afterwards. */
export function useDeleteSystemEvents() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: DeleteSystemEventsRequest) => deleteSystemEvents(payload),
    onSuccess: (res) => {
      toast.success(res.deleted === 1 ? "Deleted 1 event" : `Deleted ${res.deleted} events`)
      return queryClient.invalidateQueries({ queryKey: systemEventsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to delete: ${err.message}`),
  })
}
