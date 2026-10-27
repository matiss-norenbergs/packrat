import { useEffect, useState } from "react"
import { Puzzle } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { InfoPopover } from "@/components/ui/info-popover"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import type { FeatureKey } from "@/hooks/useFeature"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import type { UpdateSettingsRequest } from "@/types/api"
import { SaveRow } from "@/components/settings/SaveRow"

const FEATURE_TOGGLES: {
  key: FeatureKey
  label: string
  info: string
}[] = [
  {
    key: "featureSubscriptionsEnabled",
    label: "Subscriptions",
    info: "Watches channels and playlists for new videos. Turning it off hides the page and stops the scheduled checks (and the yt-dlp work they do). Your subscriptions are kept, and any that came due while it was off are checked as soon as you turn it back on.",
  },
  {
    key: "featureFileImportEnabled",
    label: "File Import",
    info: "Adds files that are already in your media folder to the library. Turning it off hides the page and its API; nothing runs in the background either way.",
  },
  {
    key: "featureCompareListEnabled",
    label: "Compare list",
    info: "The compare list and its side-by-side player. Turning it off also hides “Add to compare list” in the Library. The list itself is kept.",
  },
  {
    key: "featureFrameMatchingEnabled",
    label: "Frame Matching",
    info: "Finds the video frame that matches a thumbnail. Turning it off hides the page and the Library’s “Match from…” actions and stops the background queue worker. Queued matches are kept and resume when you turn it back on.",
  },
]

export function FeaturesTab() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  const [values, setValues] = useState<Record<FeatureKey, boolean> | null>(null)

  useEffect(() => {
    if (!settings) return
    setValues(Object.fromEntries(FEATURE_TOGGLES.map((f) => [f.key, settings[f.key]])) as Record<FeatureKey, boolean>)
  }, [settings])

  if (isLoading || !settings || !values) return <Skeleton className="h-20 w-full max-w-lg" />

  const payload: UpdateSettingsRequest = {}
  for (const { key } of FEATURE_TOGGLES) {
    if (values[key] !== settings[key]) payload[key] = values[key]
  }
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="flex min-h-full flex-col">
      <div className="max-w-3xl space-y-6 pb-6">
        <SettingsCard
          icon={Puzzle}
          title="Optional features"
          description="Turn off the parts of Packrat you don't use. A disabled feature disappears from the menu and its background work stops, but its data is never deleted — turning it back on restores everything. AI Enhancement has its own switch in the AI Enhancement tab."
        >
          <div className="max-w-lg space-y-4">
            {FEATURE_TOGGLES.map(({ key, label, info }) => (
              <div key={key} className="flex items-center gap-1.5">
                <Checkbox
                  id={key}
                  checked={values[key]}
                  onCheckedChange={(v) => setValues({ ...values, [key]: v === true })}
                />
                <Label htmlFor={key} className="font-normal">
                  {label}
                </Label>
                <InfoPopover>{info}</InfoPopover>
              </div>
            ))}
          </div>
        </SettingsCard>
      </div>
      <SaveRow
        dirty={dirty}
        isPending={updateSettings.isPending}
        isSuccess={updateSettings.isSuccess}
        onSave={() => updateSettings.mutate(payload)}
      />
    </div>
  )
}
