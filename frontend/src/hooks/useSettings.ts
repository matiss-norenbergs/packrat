import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { fetchSettings, updateSettings } from "@/lib/api"
import type { UpdateSettingsRequest } from "@/types/api"

export const settingsQueryKey = ["settings"] as const

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: fetchSettings,
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: UpdateSettingsRequest) => updateSettings(payload),
    onSuccess: () => {
      toast.success("Settings saved")
      queryClient.invalidateQueries({ queryKey: settingsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to save settings: ${err.message}`),
  })
}
