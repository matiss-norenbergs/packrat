import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  addSubscriptionEntry,
  checkSubscriptionNow,
  createSubscription,
  deleteSubscription,
  linkSubscriptionEntry,
  listSubscriptionEntries,
  listSubscriptions,
  markSubscriptionEntrySeen,
  unlinkSubscriptionEntry,
  updateSubscription,
} from "@/lib/api"
import { libraryQueryKey } from "./useLibrary"
import { downloadsQueryKey } from "./useDownloads"
import type { AddSubscriptionEntryMode, CreateSubscriptionRequest, UpdateSubscriptionRequest } from "@/types/api"

export const subscriptionsQueryKey = ["subscriptions"] as const

export function useSubscriptions() {
  return useQuery({
    queryKey: subscriptionsQueryKey,
    queryFn: listSubscriptions,
  })
}

export function useCreateSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateSubscriptionRequest) => createSubscription(payload),
    onSuccess: () => {
      toast.success("Subscription added")
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to add subscription: ${err.message}`),
  })
}

export function useUpdateSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateSubscriptionRequest }) => updateSubscription(id, payload),
    onSuccess: () => {
      toast.success("Subscription updated")
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to update subscription: ${err.message}`),
  })
}

export function useDeleteSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteSubscription(id),
    onSuccess: () => {
      toast.success("Subscription removed")
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to remove subscription: ${err.message}`),
  })
}

// No bulk-delete route exists on the backend — loops the same per-id DELETE
// the single-row action uses (mirrors useBulkDeleteHistoryItems), one call
// per selected id, and invalidates once at the end.
export function useBulkDeleteSubscriptions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => deleteSubscription(id))),
    onSuccess: (_result, ids) => {
      toast.success(`Removed ${ids.length} subscription${ids.length === 1 ? "" : "s"}`)
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to remove: ${err.message}`),
  })
}

export function useCheckSubscriptionNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => checkSubscriptionNow(id),
    onSuccess: (result) => {
      toast.success(result.newItemsFound > 0 ? `Found ${result.newItemsFound} new item(s)` : "Up to date — nothing new")
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
    },
    onError: (err: Error) => toast.error(`Check failed: ${err.message}`),
  })
}

// Same aggregation approach as useBulkDeleteSubscriptions — no bulk-check
// route exists, so this fires the per-id check concurrently for every
// selected subscription and sums the new-item counts into one toast.
export function useBulkCheckSubscriptionsNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => checkSubscriptionNow(id))),
    onSuccess: (results) => {
      const total = results.reduce((sum, r) => sum + r.newItemsFound, 0)
      toast.success(total > 0 ? `Found ${total} new item(s)` : "Up to date — nothing new")
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
    },
    onError: (err: Error) => toast.error(`Check failed: ${err.message}`),
  })
}

export function useSubscriptionEntries(subscriptionId: number, enabled: boolean) {
  return useQuery({
    queryKey: [...subscriptionsQueryKey, subscriptionId, "entries"],
    queryFn: () => listSubscriptionEntries(subscriptionId),
    enabled,
  })
}

export function useAddSubscriptionEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ subscriptionId, sourceId, mode }: { subscriptionId: number; sourceId: string; mode: AddSubscriptionEntryMode }) =>
      addSubscriptionEntry(subscriptionId, sourceId, mode),
    onSuccess: (result, { subscriptionId }) => {
      toast.success(result.mode === "ghost" ? "Added as ghost item" : "Download queued")
      // Acting on an entry also marks it seen server-side, so the
      // Subscriptions table's unseen count needs to refresh too, not just
      // the entries list.
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
      queryClient.invalidateQueries({ queryKey: [...subscriptionsQueryKey, subscriptionId, "entries"] })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to add item: ${err.message}`),
  })
}

// No success toast, deliberately — dismissing several entries back-to-back
// in the Known Items dialog shouldn't spam toasts the way a one-off action
// like "Check now" does.
export function useMarkSubscriptionEntrySeen() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ subscriptionId, sourceId }: { subscriptionId: number; sourceId: string }) =>
      markSubscriptionEntrySeen(subscriptionId, sourceId),
    onSuccess: (_data, { subscriptionId }) => {
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
      queryClient.invalidateQueries({ queryKey: [...subscriptionsQueryKey, subscriptionId, "entries"] })
    },
    onError: (err: Error) => toast.error(`Failed to mark seen: ${err.message}`),
  })
}

// No bulk-add route exists on the backend — same fan-out approach as
// useBulkDeleteSubscriptions, one POST per selected sourceId, single toast/
// invalidate once every call settles.
export function useBulkAddSubscriptionEntries() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      subscriptionId,
      sourceIds,
      mode,
    }: {
      subscriptionId: number
      sourceIds: string[]
      mode: AddSubscriptionEntryMode
    }) => Promise.all(sourceIds.map((sourceId) => addSubscriptionEntry(subscriptionId, sourceId, mode))),
    onSuccess: (_result, { subscriptionId, sourceIds, mode }) => {
      toast.success(
        `${mode === "ghost" ? "Added" : "Queued"} ${sourceIds.length} item${sourceIds.length === 1 ? "" : "s"}`,
      )
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
      queryClient.invalidateQueries({ queryKey: [...subscriptionsQueryKey, subscriptionId, "entries"] })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to add items: ${err.message}`),
  })
}

// Same fan-out approach, mirrors useMarkSubscriptionEntrySeen's own
// no-success-toast choice for the same reason.
export function useBulkMarkSubscriptionEntriesSeen() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ subscriptionId, sourceIds }: { subscriptionId: number; sourceIds: string[] }) =>
      Promise.all(sourceIds.map((sourceId) => markSubscriptionEntrySeen(subscriptionId, sourceId))),
    onSuccess: (_data, { subscriptionId }) => {
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
      queryClient.invalidateQueries({ queryKey: [...subscriptionsQueryKey, subscriptionId, "entries"] })
    },
    onError: (err: Error) => toast.error(`Failed to mark seen: ${err.message}`),
  })
}

// Backs the "Known items" dialog's "Link to library item…" action —
// single-entry only (there's no sensible bulk target to link a whole
// selection to), unlike the other row actions here.
export function useLinkSubscriptionEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ subscriptionId, sourceId, libraryItemId }: { subscriptionId: number; sourceId: string; libraryItemId: number }) =>
      linkSubscriptionEntry(subscriptionId, sourceId, libraryItemId),
    onSuccess: (_data, { subscriptionId }) => {
      toast.success("Linked")
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
      queryClient.invalidateQueries({ queryKey: [...subscriptionsQueryKey, subscriptionId, "entries"] })
    },
    onError: (err: Error) => toast.error(`Failed to link: ${err.message}`),
  })
}

// Unlink is a pure "clear," so — unlike Link — it composes fine as a bulk
// action; same fan-out approach as the other bulk hooks here.
export function useBulkUnlinkSubscriptionEntries() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ subscriptionId, sourceIds }: { subscriptionId: number; sourceIds: string[] }) =>
      Promise.all(sourceIds.map((sourceId) => unlinkSubscriptionEntry(subscriptionId, sourceId))),
    onSuccess: (_result, { subscriptionId, sourceIds }) => {
      toast.success(`Unlinked ${sourceIds.length} item${sourceIds.length === 1 ? "" : "s"}`)
      queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
      queryClient.invalidateQueries({ queryKey: [...subscriptionsQueryKey, subscriptionId, "entries"] })
    },
    onError: (err: Error) => toast.error(`Failed to unlink: ${err.message}`),
  })
}
