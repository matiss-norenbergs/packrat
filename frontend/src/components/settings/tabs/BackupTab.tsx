import { Archive } from "lucide-react"
import { FieldLabel } from "@/components/ui/info-popover"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUpdateSettings } from "@/hooks/useSettings"
import type { Settings, UpdateSettingsRequest } from "@/types/api"
import { SaveRow } from "@/components/settings/SaveRow"
import { SettingsTabLoader } from "@/components/settings/SettingsTabLoader"
import { useSettingsDraft } from "@/hooks/useSettingsDraft"

const AUTO_BACKUP_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "Off" },
  { value: "6", label: "Every 6 hours" },
  { value: "12", label: "Every 12 hours" },
  { value: "24", label: "Every day" },
  { value: "72", label: "Every 3 days" },
  { value: "168", label: "Every week" },
]

const BACKUP_RETENTION_OPTIONS: { value: string; label: string }[] = [
  { value: "7", label: "7 backups" },
  { value: "14", label: "14 backups" },
  { value: "30", label: "30 backups" },
  { value: "50", label: "50 backups" },
  { value: "100", label: "100 backups" },
  { value: "0", label: "Unlimited" },
]

function toForm(s: Settings) {
  return {
    intervalHours: String(s.autoBackupIntervalHours),
    retentionCount: String(s.backupRetentionCount),
  }
}

export function BackupTab() {
  return (
    <SettingsTabLoader skeletonClassName="h-16 w-full max-w-lg">
      {(settings) => <BackupTabBody settings={settings} />}
    </SettingsTabLoader>
  )
}

function BackupTabBody({ settings }: { settings: Settings }) {
  const updateSettings = useUpdateSettings()
  const { field, afterSave } = useSettingsDraft(settings, toForm)
  const [intervalHours, setIntervalHours] = field("intervalHours")
  const [retentionCount, setRetentionCount] = field("retentionCount")

  const payload: UpdateSettingsRequest = {}
  const interval = Number(intervalHours)
  if (interval !== settings.autoBackupIntervalHours) payload.autoBackupIntervalHours = interval
  const retention = Number(retentionCount)
  if (retention !== settings.backupRetentionCount) payload.backupRetentionCount = retention
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="flex min-h-full flex-col">
      <div className="max-w-3xl space-y-6 pb-6">
        <SettingsCard icon={Archive} title="Automatic backups">
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="auto-backup-interval"
                info="Saves a full snapshot of your settings and library data under the Backup page. Off by default."
              >
                Back up automatically
              </FieldLabel>
              <Select value={intervalHours} onValueChange={setIntervalHours}>
                <SelectTrigger id="auto-backup-interval" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTO_BACKUP_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <FieldLabel
                htmlFor="backup-retention-count"
                info="How many backups (scheduled and manual) to keep on disk before the oldest are automatically deleted. Unlimited keeps every backup ever made — make sure you have the disk space."
              >
                Keep
              </FieldLabel>
              <Select value={retentionCount} onValueChange={setRetentionCount}>
                <SelectTrigger id="backup-retention-count" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BACKUP_RETENTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
