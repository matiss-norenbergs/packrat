import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { fetchPreferences, updatePreferences } from "@/lib/api"
import type { UserPreferences } from "@/types/api"

// Not under "auth": markLoggedOut and the 401 handler keep that key family (the auth-status query) and
// drop everything else, so the previous account's preferences must not live there.
export const preferencesQueryKey = ["preferences"] as const

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
