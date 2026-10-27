import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { History as HistoryIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldLabel, InfoPopover } from "@/components/ui/info-popover"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useClearHistory } from "@/hooks/useHistory"
import { useUpdateSettings } from "@/hooks/useSettings"
import type { Settings, UpdateSettingsRequest } from "@/types/api"
import { SaveRow } from "@/components/settings/SaveRow"
import { RETENTION_OPTIONS } from "@/components/settings/retention"
import { SettingsTabLoader } from "@/components/settings/SettingsTabLoader"
import { useSettingsDraft } from "@/hooks/useSettingsDraft"

function toForm(s: Settings) {
  return {
    anonymize: s.historyAnonymizeUrls,
    retentionDays: String(s.historyRetentionDays),
  }
}

export function HistoryTab() {
  return (
    <SettingsTabLoader skeletonClassName="h-20 w-full max-w-lg">
      {(settings) => <HistoryTabBody settings={settings} />}
    </SettingsTabLoader>
  )
}

function HistoryTabBody({ settings }: { settings: Settings }) {
  const updateSettings = useUpdateSettings()
  const clearHistory = useClearHistory()
  const { field, afterSave } = useSettingsDraft(settings, toForm)
  const [anonymize, setAnonymize] = field("anonymize")
  const [retentionDays, setRetentionDays] = field("retentionDays")

  const payload: UpdateSettingsRequest = {}
  if (anonymize !== settings.historyAnonymizeUrls) payload.historyAnonymizeUrls = anonymize
  const retention = Number(retentionDays)
  if (retention !== settings.historyRetentionDays) payload.historyRetentionDays = retention
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="flex min-h-full flex-col">
      <div className="max-w-3xl space-y-6 pb-6">
        <SettingsCard icon={HistoryIcon} title="History">
          <div className="max-w-lg space-y-4">
            <div className="flex items-center gap-1.5">
              <Checkbox id="history-anonymize" checked={anonymize} onCheckedChange={(v) => setAnonymize(v === true)} />
              <Label htmlFor="history-anonymize" className="font-normal">
                Anonymize History Links
              </Label>
              <InfoPopover>
                Replaces links on the History page with a hash — the actual file/download is
                unaffected, and Retry still works.
              </InfoPopover>
            </div>

            <div className="space-y-2">
              <FieldLabel
                htmlFor="history-retention"
                info="History entries older than this are deleted automatically. Doesn't affect your library files or downloads — only the History page's log."
              >
                Keep history for
              </FieldLabel>
              <Select value={retentionDays} onValueChange={setRetentionDays}>
                <SelectTrigger id="history-retention" className="w-40">
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

            <div className="flex items-center gap-3">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={clearHistory.isPending}>
                    Clear all now
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete all history entries?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Removes every entry from the History page right now, regardless of age.
                      Doesn't affect your library files or downloads.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => clearHistory.mutate()}>Delete all</AlertDialogAction>
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
