import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  fetchImageBackfillStatus,
  fetchSettings,
  fetchYtDlpVersion,
  rescanJellyfinLibrary,
  startImageBackfill,
  updateSettings,
  updateYtDlp,
} from "@/lib/api"
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

export const imageBackfillStatusQueryKey = ["settings", "image-backfill"] as const

// Polls every 2s only while a run is in progress — cheap in-memory status
// read on the backend, and this is the only place in the app that needs a
// "is a background job still running" poll loop.
export function useImageBackfillStatus() {
  return useQuery({
    queryKey: imageBackfillStatusQueryKey,
    queryFn: fetchImageBackfillStatus,
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  })
}

export function useStartImageBackfill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => startImageBackfill(),
    onSuccess: (data) => {
      queryClient.setQueryData(imageBackfillStatusQueryKey, data)
      toast.success("Image backfill started — this can take a while for a large library")
    },
    onError: (err: Error) => toast.error(`Failed to start image backfill: ${err.message}`),
  })
}
