import { HardDrive, SlidersHorizontal } from "lucide-react"
import { FieldLabel } from "@/components/ui/info-popover"
import { Input } from "@/components/ui/input"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { useUpdateSettings } from "@/hooks/useSettings"
import type { Settings, UpdateSettingsRequest } from "@/types/api"
import { SaveRow } from "@/components/settings/SaveRow"
import { SettingsTabLoader } from "@/components/settings/SettingsTabLoader"
import { useSettingsDraft } from "@/hooks/useSettingsDraft"

// Mirrors models.MaxConcurrentDownloadsLimit on the backend (PATCH answers 400 above it).
const MAX_CONCURRENT_DOWNLOADS = 16

function toForm(s: Settings) {
  return {
    maxConcurrent: String(s.maxConcurrentDownloads),
    maxConcurrentTranscodes: String(s.maxConcurrentTranscodes),
    downloadTimeout: String(s.downloadTimeoutMinutes),
  }
}

export function GeneralTab() {
  return (
    <SettingsTabLoader skeletonClassName="h-24 w-full max-w-lg">
      {(settings) => <GeneralTabBody settings={settings} />}
    </SettingsTabLoader>
  )
}

function GeneralTabBody({ settings }: { settings: Settings }) {
  const updateSettings = useUpdateSettings()
  const { field, afterSave } = useSettingsDraft(settings, toForm)
  const [maxConcurrent, setMaxConcurrent] = field("maxConcurrent")
  const [maxConcurrentTranscodes, setMaxConcurrentTranscodes] = field("maxConcurrentTranscodes")
  const [downloadTimeout, setDownloadTimeout] = field("downloadTimeout")

  const payload: UpdateSettingsRequest = {}
  const n = Number(maxConcurrent)
  const maxConcurrentTooHigh = n > MAX_CONCURRENT_DOWNLOADS
  if (n > 0 && !maxConcurrentTooHigh && n !== settings.maxConcurrentDownloads) payload.maxConcurrentDownloads = n
  const nTranscodes = Number(maxConcurrentTranscodes)
  if (nTranscodes > 0 && nTranscodes !== settings.maxConcurrentTranscodes) payload.maxConcurrentTranscodes = nTranscodes
  const timeout = Number(downloadTimeout)
  if (timeout >= 0 && timeout !== settings.downloadTimeoutMinutes) payload.downloadTimeoutMinutes = timeout
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="flex min-h-full flex-col">
      <div className="max-w-3xl space-y-6 pb-6">
        <SettingsCard icon={HardDrive} title="Storage">
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="download-directory"
                info={<>Set via the <code>MEDIA_ROOT</code> environment variable — not editable here.</>}
              >
                Download Directory
              </FieldLabel>
              <Input id="download-directory" value={settings.downloadDirectory} disabled />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard icon={SlidersHorizontal} title="Limits">
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <Label htmlFor="max-concurrent">Max Concurrent Downloads</Label>
              <Input
                id="max-concurrent"
                type="number"
                min="1"
                max={MAX_CONCURRENT_DOWNLOADS}
                value={maxConcurrent}
                onChange={(e) => setMaxConcurrent(e.target.value)}
              />
              <p className={`text-xs ${maxConcurrentTooHigh ? "text-destructive" : "text-muted-foreground"}`}>
                1 to {MAX_CONCURRENT_DOWNLOADS}
              </p>
            </div>

            <div className="space-y-2">
              <FieldLabel
                htmlFor="max-concurrent-transcodes"
                info="Caps how many trim previews can be generated (ffmpeg re-encodes) at the same time — separate from the download limit above, since trimming is triggered on demand rather than queued."
              >
                Max Concurrent Transcodes
              </FieldLabel>
              <Input
                id="max-concurrent-transcodes"
                type="number"
                min="1"
                value={maxConcurrentTranscodes}
                onChange={(e) => setMaxConcurrentTranscodes(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <FieldLabel
                htmlFor="download-timeout"
                info="Kills and marks failed any download still running past this limit. 0 = no limit."
              >
                Download Timeout (minutes)
              </FieldLabel>
              <Input
                id="download-timeout"
                type="number"
                min="0"
                placeholder="No limit"
                value={downloadTimeout}
                onChange={(e) => setDownloadTimeout(e.target.value)}
              />
            </div>
          </div>
        </SettingsCard>
      </div>
      <SaveRow
        dirty={dirty}
        isPending={updateSettings.isPending}
        isSuccess={updateSettings.isSuccess}
        onSave={() => updateSettings.mutate(payload, { onSuccess: afterSave })}
      />
    </div>
  )
}
