import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  acceptFrameMatchQueueItem,
  bulkStartFrameMatch,
  discardFrameMatchQueueItem,
  fetchFrameMatchQueue,
} from "@/lib/api"
import { libraryQueryKey } from "./useLibrary"
import type { FrameMatchMode } from "@/types/api"

export const frameMatchQueueQueryKey = ["frame-match-queue"] as const

// useFrameMatchQueue backs the "Frame Matching" page — live updates arrive
// over the frame_match_progress WebSocket event (see useDownloadsSocket),
// which invalidates this query on every state change, so no polling
// interval is needed here.
export function useFrameMatchQueue() {
  return useQuery({
    queryKey: frameMatchQueueQueryKey,
    queryFn: fetchFrameMatchQueue,
  })
}

// useBulkStartFrameMatch backs the Library toolbar's "Match from URL/
// Current Thumbnail…" bulk actions — fire-and-forget, like the other bulk
// background jobs in this app: enqueues and returns immediately, with
// progress streaming live over frame_match_progress rather than this
// mutation's own completion.
export function useBulkStartFrameMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ itemIds, mode }: { itemIds: number[]; mode: FrameMatchMode }) => bulkStartFrameMatch(itemIds, mode),
    onSuccess: (result) => {
      const notes = []
      if (result.alreadyQueued > 0) notes.push(`${result.alreadyQueued} already queued`)
      if (result.skipped > 0) notes.push(`${result.skipped} ineligible`)
      toast.success(
        notes.length > 0
          ? `Queued ${result.queued} item(s) for matching, skipped ${notes.join(", ")}`
          : `Queued ${result.queued} item(s) for matching`,
      )
      queryClient.invalidateQueries({ queryKey: frameMatchQueueQueryKey })
    },
    onError: (err: Error) => toast.error(`Frame matching failed: ${err.message}`),
  })
}

// useAcceptFrameMatchQueueItem backs the Frame Matching page's "Use this
// frame" action — commits the found frame as the item's thumbnail and
// removes the row, since this is a working queue, not a permanent history.
export function useAcceptFrameMatchQueueItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: acceptFrameMatchQueueItem,
    onSuccess: () => {
      toast.success("Thumbnail updated")
      queryClient.invalidateQueries({ queryKey: frameMatchQueueQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Couldn't use this frame: ${err.message}`),
  })
}

// useDiscardFrameMatchQueueItem backs "Discard" on a done row, "Dismiss" on
// an error row, and removing a still-queued/running row from the queue
// outright — all the same action: delete the row and any snapshot images
// without touching the item's thumbnail.
export function useDiscardFrameMatchQueueItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: discardFrameMatchQueueItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: frameMatchQueueQueryKey })
    },
    onError: (err: Error) => toast.error(`Couldn't remove item: ${err.message}`),
  })
}
