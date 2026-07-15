import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { fetchSettings, fetchYtDlpVersion, rescanJellyfinLibrary, updateSettings, updateYtDlp } from "@/lib/api"
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

export function useRescanJellyfinLibrary() {
  return useMutation({
    mutationFn: () => rescanJellyfinLibrary(),
    onSuccess: () => toast.success("Jellyfin library rescan triggered"),
    onError: (err: Error) => toast.error(`Rescan failed: ${err.message}`),
  })
}

export const ytdlpVersionQueryKey = ["ytdlp", "version"] as const

export function useYtDlpVersion() {
  return useQuery({
    queryKey: ytdlpVersionQueryKey,
    queryFn: fetchYtDlpVersion,
    staleTime: 60 * 60 * 1000, // 1h — checking PyPI for a new release isn't time-sensitive
  })
}

export function useUpdateYtDlp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => updateYtDlp(),
    onSuccess: (data) => {
      toast.success(`yt-dlp updated to ${data.version}`)
      queryClient.invalidateQueries({ queryKey: ytdlpVersionQueryKey })
    },
    onError: (err: Error) => toast.error(`Update failed: ${err.message}`),
  })
}
