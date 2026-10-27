import { useEffect, useState } from "react"
import { Plug, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldLabel, InfoPopover } from "@/components/ui/info-popover"
import { Input } from "@/components/ui/input"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useRescanJellyfinLibrary, useSettings, useUpdateSettings } from "@/hooks/useSettings"
import type { UpdateSettingsRequest } from "@/types/api"
import { SaveRow } from "@/components/settings/SaveRow"

export function JellyfinTab() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const rescan = useRescanJellyfinLibrary()

  const [enabled, setEnabled] = useState(false)
  const [url, setUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [refreshMode, setRefreshMode] = useState("none")

  useEffect(() => {
    if (!settings) return
    setEnabled(settings.jellyfinEnabled)
    setUrl(settings.jellyfinUrl)
    setApiKey(settings.jellyfinApiKey)
    setRefreshMode(settings.jellyfinRefreshMode || "none")
  }, [settings])

  if (isLoading || !settings) return <Skeleton className="h-40 w-full max-w-lg" />

  const payload: UpdateSettingsRequest = {}
  if (enabled !== settings.jellyfinEnabled) payload.jellyfinEnabled = enabled
  if (url !== settings.jellyfinUrl) payload.jellyfinUrl = url
  if (apiKey !== settings.jellyfinApiKey) payload.jellyfinApiKey = apiKey
  if (refreshMode !== settings.jellyfinRefreshMode) payload.jellyfinRefreshMode = refreshMode
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="flex min-h-full flex-col">
      <div className="max-w-3xl space-y-6 pb-6">
        <SettingsCard icon={Plug} title="Connection">
          <div className="max-w-lg space-y-4">
            <div className="flex items-center gap-1.5">
              <Checkbox id="jellyfin-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
              <Label htmlFor="jellyfin-enabled" className="font-normal">
                Enable Jellyfin
              </Label>
              <InfoPopover>
                Lets you manually trigger a library rescan below, and controls the automatic
                refresh option underneath.
              </InfoPopover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="jellyfin-url">URL</Label>
              <Input
                id="jellyfin-url"
                placeholder="http://jellyfin:8096"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!enabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="jellyfin-api-key">API Key</Label>
              <Input
                id="jellyfin-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!enabled}
              />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard icon={RefreshCw} title="Library refresh">
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="jellyfin-refresh-mode"
                info={
                  <>
                    "Specific library" refreshes only the Jellyfin library linked to the download's
                    collection (set per-collection in Collections → Edit) — downloads in a
                    collection with no library linked, or uncategorized downloads, don't trigger
                    anything. A burst of downloads within a short window is coalesced into a single
                    rescan.
                  </>
                }
              >
                Refresh after download
              </FieldLabel>
              <Select value={refreshMode} onValueChange={setRefreshMode} disabled={!enabled}>
                <SelectTrigger id="jellyfin-refresh-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nothing</SelectItem>
                  <SelectItem value="entire">Entire library</SelectItem>
                  <SelectItem value="specific">Specific library</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => rescan.mutate()}
                disabled={!enabled || !url || !apiKey || rescan.isPending}
              >
                {rescan.isPending ? "Rescanning…" : "Rescan Library Now"}
              </Button>
              <span className="text-xs text-muted-foreground">Runs immediately; not part of Save.</span>
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
