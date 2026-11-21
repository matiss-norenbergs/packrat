import type { SettingAdjustment } from "@/types/api"
import { toast } from "sonner"
import { plural } from "@/lib/backupCollections"

// One line per adjusted value: "max_concurrent_downloads 5000 → 16" for a clamp, otherwise what
// happened to the value ("skipped" keeps the stored value, "dropped" removed unknown entries).
export function adjustmentLines(list: SettingAdjustment[] | null | undefined): string[] {
  return (list ?? []).map((a) => {
    if (a.action === "clamped" && a.from != null && a.to != null) return `${a.key} ${a.from} → ${a.to}`
    return `${a.key} ${a.action}`
  })
}

// Tells the user which settings values a settings import / full restore changed instead of writing
// them as they were in the file: an info toast after the success toast. Nothing is shown when nothing
// was adjusted, and a result from an older server (no `adjusted`) counts as nothing adjusted.
export function notifySettingsAdjusted(adjusted: SettingAdjustment[] | null | undefined) {
  const list = adjusted ?? []
  if (list.length === 0) return
  const allClamped = list.every((a) => a.action === "clamped")
  toast.info(
    `${plural(list.length, "value")} ${list.length === 1 ? "was" : "were"} adjusted` + (allClamped ? " to their limits" : ""),
    { description: adjustmentLines(list).join("; "), duration: 20000 },
  )
}
