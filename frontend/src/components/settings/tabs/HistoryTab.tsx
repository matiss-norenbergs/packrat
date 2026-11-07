import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { History as HistoryIcon, ScrollText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldLabel, InfoPopover } from "@/components/ui/info-popover"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useClearHistory } from "@/hooks/useHistory"
import { useDeleteSystemEvents, useSystemEventFacets } from "@/hooks/useSystemEvents"
import { useUpdateSettings } from "@/hooks/useSettings"
import type { Settings, UpdateSettingsRequest } from "@/types/api"
import { SaveRow } from "@/components/settings/SaveRow"
import { RETENTION_OPTIONS, SYSTEM_EVENT_COUNT_OPTIONS } from "@/components/settings/retention"
import { SettingsTabLoader } from "@/components/settings/SettingsTabLoader"
import { useSettingsDraft } from "@/hooks/useSettingsDraft"

function toForm(s: Settings) {
  return {
    anonymize: s.historyAnonymizeUrls,
    retentionDays: String(s.historyRetentionDays),
    systemEventsEnabled: s.featureSystemEventsEnabled,
    systemEventsCount: String(s.systemEventsRetentionCount),
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
  const clearSystemEvents = useDeleteSystemEvents()
  // The stored events can only be counted (and cleared) while the log is switched on: its routes are refused otherwise.
  const { data: facets } = useSystemEventFacets(settings.featureSystemEventsEnabled)
  const eventCount = facets?.levels.reduce((sum, f) => sum + f.count, 0)
  const { field, afterSave } = useSettingsDraft(settings, toForm)
  const [anonymize, setAnonymize] = field("anonymize")
  const [retentionDays, setRetentionDays] = field("retentionDays")
  const [eventsEnabled, setEventsEnabled] = field("systemEventsEnabled")
  const [eventsCount, setEventsCount] = field("systemEventsCount")

  const payload: UpdateSettingsRequest = {}
  if (anonymize !== settings.historyAnonymizeUrls) payload.historyAnonymizeUrls = anonymize
  const retention = Number(retentionDays)
  if (retention !== settings.historyRetentionDays) payload.historyRetentionDays = retention
  if (eventsEnabled !== settings.featureSystemEventsEnabled) payload.featureSystemEventsEnabled = eventsEnabled
  const keepEvents = Number(eventsCount)
  if (keepEvents !== settings.systemEventsRetentionCount) payload.systemEventsRetentionCount = keepEvents
  const dirty = Object.keys(payload).length > 0
  // A count set through the API that is not one of the presets still shows up in the dropdown.
  const countOptions = SYSTEM_EVENT_COUNT_OPTIONS.some((o) => o.value === eventsCount)
    ? SYSTEM_EVENT_COUNT_OPTIONS
    : [{ value: eventsCount, label: `${Number(eventsCount).toLocaleString()} events` }, ...SYSTEM_EVENT_COUNT_OPTIONS]

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

        <SettingsCard
          icon={ScrollText}
          title="System log"
          description="A short record of notable server events (startups, updates, backups, security changes) that survives updates. Shown on the Logs page under System. It never records links, titles, file names or passwords, and isn't part of backups."
        >
          <div className="max-w-lg space-y-4">
            <div className="flex items-center gap-1.5">
              <Checkbox id="system-events-enabled" checked={eventsEnabled} onCheckedChange={(v) => setEventsEnabled(v === true)} />
              <Label htmlFor="system-events-enabled" className="font-normal">
                Record system events
              </Label>
              <InfoPopover>
                Turning it off stops recording and hides the System view on the Logs page. Events already stored
                are kept and show up again when you turn it back on. Console logging is unaffected.
              </InfoPopover>
            </div>

            <div className="space-y-2">
              <FieldLabel
                htmlFor="system-events-count"
                info="When there are more events than this, the oldest are deleted automatically (right after you save, and then hourly). Unlimited never deletes any."
              >
                Keep the last
              </FieldLabel>
              <Select value={eventsCount} onValueChange={setEventsCount}>
                <SelectTrigger id="system-events-count" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {countOptions.map((opt) => (
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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={clearSystemEvents.isPending || !settings.featureSystemEventsEnabled || eventCount === 0}
                  >
                    Clear all now
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Delete {eventCount == null ? "all system events" : eventCount === 1 ? "1 system event" : `all ${eventCount.toLocaleString()} system events`}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Removes every event from the system log right now. This can't be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => clearSystemEvents.mutate({ all: true })}>Delete all</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <span className="text-xs text-muted-foreground">
                {settings.featureSystemEventsEnabled
                  ? `${eventCount == null ? "" : `${eventCount.toLocaleString()} stored. `}Runs immediately; not part of Save.`
                  : "Turn the log on and save to manage stored events."}
              </span>
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
