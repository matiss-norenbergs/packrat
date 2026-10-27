import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { settingsQueryKey } from "@/hooks/useSettings"
import type { Settings } from "@/types/api"

// Form state for a settings tab without copying server data into state: only
// the user's EDITS are stored, and every field reads `edit ?? server value`.
// So a background refetch that brings new server data never wipes what is
// being typed, while fields nobody touched follow the server.
//
// `toForm` maps the server settings to the shape the tab edits (numbers kept
// as strings for inputs, sentinels like "none", ...); it must be a stable
// (module-level) function. The tab computes its `payload`/`dirty` by comparing
// the form values against `settings`, as before.
//
// After a successful save call `afterSave` (mutate(payload, { onSuccess: afterSave })):
// it drops the edits so the form shows what the server actually stored,
// including any normalization. It keeps them if the follow-up refetch failed,
// since then the cache still holds the pre-save values. The edits are cleared
// rather than the form being remounted with a `key` because the Save row's
// "Saved" status lives in the tab's mutation state, which a remount would reset.
export function useSettingsDraft<F extends object>(settings: Settings, toForm: (s: Settings) => F) {
  const queryClient = useQueryClient()
  const [edits, setEdits] = useState<Partial<F>>({})
  const form: F = { ...toForm(settings), ...edits }

  const set = <K extends keyof F>(key: K, value: F[K]) => setEdits((prev) => ({ ...prev, [key]: value }))
  // useState-shaped accessor, so a tab reads `const [url, setUrl] = field("url")`.
  const field = <K extends keyof F>(key: K) => [form[key], (value: F[K]) => set(key, value)] as const
  const afterSave = () => {
    if (queryClient.getQueryState(settingsQueryKey)?.status !== "error") setEdits({})
  }

  return { form, set, field, afterSave }
}
