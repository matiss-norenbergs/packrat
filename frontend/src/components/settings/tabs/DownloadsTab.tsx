import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Download, FileImage, ScrollText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldLabel, InfoPopover } from "@/components/ui/info-popover"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useClearDownloadLog } from "@/hooks/useDownloads"
import { useUpdateSettings } from "@/hooks/useSettings"
import type { DownloadType, Settings, UpdateSettingsRequest, VideoQuality } from "@/types/api"
import { SaveRow } from "@/components/settings/SaveRow"
import { RETENTION_OPTIONS } from "@/components/settings/retention"
import { SettingsTabLoader } from "@/components/settings/SettingsTabLoader"
import { useSettingsDraft } from "@/hooks/useSettingsDraft"

const VIDEO_QUALITIES: VideoQuality[] = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"]

function toForm(s: Settings) {
  return {
    defaultQuality: s.defaultQuality as VideoQuality,
    defaultDownloadType: s.defaultDownloadType,
    skipDownloadPreview: s.skipDownloadPreview,
    logRetentionDays: String(s.downloadLogRetentionDays),
    imageConvertFormat: s.imageConvertFormat,
  }
}

export function DownloadsTab() {
  return (
    <SettingsTabLoader skeletonClassName="h-24 w-full max-w-lg">
      {(settings) => <DownloadsTabBody settings={settings} />}
    </SettingsTabLoader>
  )
}

function DownloadsTabBody({ settings }: { settings: Settings }) {
  const updateSettings = useUpdateSettings()
  const clearDownloadLog = useClearDownloadLog()
  const { field, afterSave } = useSettingsDraft(settings, toForm)
  const [defaultQuality, setDefaultQuality] = field("defaultQuality")
  const [defaultDownloadType, setDefaultDownloadType] = field("defaultDownloadType")
  const [skipDownloadPreview, setSkipDownloadPreview] = field("skipDownloadPreview")
  const [logRetentionDays, setLogRetentionDays] = field("logRetentionDays")
  const [imageConvertFormat, setImageConvertFormat] = field("imageConvertFormat")

  const payload: UpdateSettingsRequest = {}
  if (defaultQuality !== settings.defaultQuality) payload.defaultQuality = defaultQuality
  if (defaultDownloadType !== settings.defaultDownloadType) payload.defaultDownloadType = defaultDownloadType
  if (skipDownloadPreview !== settings.skipDownloadPreview) payload.skipDownloadPreview = skipDownloadPreview
  const retention = Number(logRetentionDays)
  if (retention !== settings.downloadLogRetentionDays) payload.downloadLogRetentionDays = retention
  if (imageConvertFormat !== settings.imageConvertFormat) payload.imageConvertFormat = imageConvertFormat
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="flex min-h-full flex-col">
      <div className="max-w-3xl space-y-6 pb-6">
        <SettingsCard icon={Download} title="New downloads">
          <div className="max-w-lg space-y-4">
            <div className="flex gap-4">
              <div className="flex-1 space-y-2">
                <Label>Default Type</Label>
                <Select value={defaultDownloadType} onValueChange={(v) => setDefaultDownloadType(v as DownloadType)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="audio">Audio</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-2">
                <Label>Default Quality</Label>
                <Select value={defaultQuality} onValueChange={(v) => setDefaultQuality(v as VideoQuality)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VIDEO_QUALITIES.map((q) => (
                      <SelectItem key={q} value={q}>
                        {q}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Checkbox
                id="skip-download-preview"
                checked={skipDownloadPreview}
                onCheckedChange={(v) => setSkipDownloadPreview(v === true)}
              />
              <Label htmlFor="skip-download-preview" className="font-normal">
                I trust this source (skip preview)
              </Label>
              <InfoPopover>
                Skips the thumbnail/title preview in the New Download dialog and queues
                immediately. Shown by default so you can catch a bad URL before it fails in the
                queue.
              </InfoPopover>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard icon={FileImage} title="Images">
          <div className="space-y-2">
            <FieldLabel
              htmlFor="image-convert-format"
              info="What format a downloaded image gets converted to. Original keeps whatever format the source served."
            >
              Image conversion format
            </FieldLabel>
            <Select value={imageConvertFormat} onValueChange={(v) => setImageConvertFormat(v as typeof imageConvertFormat)}>
              <SelectTrigger id="image-convert-format" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="original">Original</SelectItem>
                <SelectItem value="jpg">JPEG</SelectItem>
                <SelectItem value="png">PNG</SelectItem>
                <SelectItem value="webp">WebP</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </SettingsCard>

        <SettingsCard icon={ScrollText} title="Download log">
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="download-log-retention"
                info="Entries older than this are deleted automatically from the Downloads and Logs pages. Only completed/failed/cancelled entries are ever removed — anything still queued or in progress is never touched, regardless of age."
              >
                Keep download log for
              </FieldLabel>
              <Select value={logRetentionDays} onValueChange={setLogRetentionDays}>
                <SelectTrigger id="download-log-retention" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETENTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={clearDownloadLog.isPending}>
                    Clear all now
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete all download log entries?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Removes every completed/failed/cancelled entry from the Downloads and Logs
                      pages right now, regardless of age. Anything still queued or in progress is
                      left untouched.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => clearDownloadLog.mutate()}>Delete all</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <span className="text-xs text-muted-foreground">Runs immediately; not part of Save.</span>
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
