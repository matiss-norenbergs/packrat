import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { fetchPreferences, updatePreferences } from "@/lib/api"
import type { UserPreferences } from "@/types/api"

export const preferencesQueryKey = ["auth", "preferences"] as const

// Only call from the authenticated layout; `enabled` lets callers hold it off.
export function usePreferences(enabled = true) {
  return useQuery({ queryKey: preferencesQueryKey, queryFn: fetchPreferences, enabled })
}

// Sends only the changed key. A failure keeps the value applied on this device.
export function useUpdatePreferences() {
  return useMutation({
    mutationFn: (payload: Partial<UserPreferences>) => updatePreferences(payload),
    onError: () => toast.error("Couldn't save your appearance to the server; kept on this device"),
  })
}
