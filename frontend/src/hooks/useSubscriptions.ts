import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  addSubscriptionEntry,
  checkSubscriptionNow,
  createSubscription,
  deleteSubscription,
  listSubscriptionEntries,
  listSubscriptions,
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
      queryClient.invalidateQueries({ queryKey: [...subscriptionsQueryKey, subscriptionId, "entries"] })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to add item: ${err.message}`),
  })
}
