import { useEffect, useState } from "react"
import { Lock } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldLabel, InfoPopover } from "@/components/ui/info-popover"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import type { UpdateSettingsRequest } from "@/types/api"
import { SaveRow } from "@/components/settings/SaveRow"

const BLUR_STRENGTH_OPTIONS: { value: string; label: string }[] = [
  { value: "weak", label: "Weak" },
  { value: "default", label: "Default" },
  { value: "strong", label: "Strong" },
]

export function PrivacyTab() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  const [enabled, setEnabled] = useState(false)
  const [blurStrength, setBlurStrength] = useState("default")
  const [browseIgnorePrivacy, setBrowseIgnorePrivacy] = useState(false)

  useEffect(() => {
    if (!settings) return
    setEnabled(settings.privacyEnabled)
    setBlurStrength(settings.privacyBlurStrength)
    setBrowseIgnorePrivacy(settings.browseIgnorePrivacy)
  }, [settings])

  if (isLoading || !settings) return <Skeleton className="h-20 w-full max-w-lg" />

  const payload: UpdateSettingsRequest = {}
  if (enabled !== settings.privacyEnabled) payload.privacyEnabled = enabled
  if (blurStrength !== settings.privacyBlurStrength) payload.privacyBlurStrength = blurStrength
  if (browseIgnorePrivacy !== settings.browseIgnorePrivacy) payload.browseIgnorePrivacy = browseIgnorePrivacy
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="flex min-h-full flex-col">
      <div className="max-w-3xl space-y-6 pb-6">
        <SettingsCard icon={Lock} title="Privacy">
          <div className="max-w-lg space-y-4">
            <div className="flex items-center gap-1.5">
              <Checkbox id="privacy-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
              <Label htmlFor="privacy-enabled" className="font-normal">
                Enable privacy
              </Label>
              <InfoPopover>
                Master switch for the whole privacy workflow. When off, every privacy feature
                (blurring, lock icons, the reveal-all button, the Private checkboxes on
                collections/tags) is hidden app-wide — but a collection or tag's own Private
                value is never changed, so turning this back on restores blurring exactly where
                it was.
              </InfoPopover>
            </div>

            <div className="space-y-2">
              <FieldLabel
                htmlFor="privacy-blur-strength"
                info="How strongly thumbnails in private collections are blurred until clicked to reveal."
              >
                Private Collection Blur Strength
              </FieldLabel>
              <Select value={blurStrength} onValueChange={setBlurStrength} disabled={!enabled}>
                <SelectTrigger id="privacy-blur-strength" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BLUR_STRENGTH_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Checkbox
                id="browse-ignore-privacy"
                checked={browseIgnorePrivacy}
                disabled={!enabled}
                onCheckedChange={(v) => setBrowseIgnorePrivacy(v === true)}
              />
              <Label htmlFor="browse-ignore-privacy" className="font-normal">
                Show private items unblurred in Browse
              </Label>
              <InfoPopover>
                Only affects the Browse page — Library and Collections keep blurring private
                items as usual.
              </InfoPopover>
            </div>
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
