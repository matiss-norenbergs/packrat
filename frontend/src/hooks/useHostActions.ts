import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { listHostActions, runHostAction } from "@/lib/api"
import type { HostAction } from "@/types/api"

// The list only changes when the container is recreated with new env vars,
// so it's fetched once per session.
export function useHostActions() {
  return useQuery({
    queryKey: ["host-actions"],
    queryFn: listHostActions,
    staleTime: Infinity,
  })
}

export function useRunHostAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: HostAction) => runHostAction(action.id),
    onSuccess: (result, action) => {
      if (result.ok) {
        toast.success(`${action.label}: ${result.message}`)
      } else {
        toast.error(`${action.label} failed: ${result.message}`)
      }
      // An action often starts/stops a service whose status Packrat shows
      // (e.g. the Stable Diffusion dot) — re-check now instead of waiting
      // for the next poll.
      queryClient.invalidateQueries({ queryKey: ["thumbnail-enhancement-status"] })
    },
    onError: (err: Error, action) => toast.error(`${action.label} failed: ${err.message}`),
  })
}
