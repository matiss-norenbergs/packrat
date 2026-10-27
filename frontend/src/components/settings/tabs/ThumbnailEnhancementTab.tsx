import { Link } from "react-router-dom"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { History as HistoryIcon, Maximize2, Server, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldLabel, InfoPopover } from "@/components/ui/info-popover"
import { Input } from "@/components/ui/input"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { PresetOrCustomNumberField } from "@/components/ui/preset-or-custom-number-field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUpdateSettings } from "@/hooks/useSettings"
import { useClearThumbnailEnhancementHistory, useThumbnailUpscalers } from "@/hooks/useThumbnailEnhancement"
import type { Settings, UpdateSettingsRequest } from "@/types/api"
import { SaveRow } from "@/components/settings/SaveRow"
import { RETENTION_OPTIONS } from "@/components/settings/retention"
import { SettingsTabLoader } from "@/components/settings/SettingsTabLoader"
import { useSettingsDraft } from "@/hooks/useSettingsDraft"

// UpscalerField starts as a plain text input (the free-text value already
// saved, or nothing yet) — clicking "Load models" queries the currently
// typed URL/credentials (not necessarily saved) and, on success, swaps in a
// Select of that instance's actual upscalers plus a "Custom…" fallback, so
// a value from an older/different instance that's no longer offered still
// shows correctly instead of silently resetting.
const CUSTOM_UPSCALER = "custom"

function UpscalerField({
  id,
  value,
  onChange,
  url,
  username,
  password,
  disabled,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  url: string
  username: string
  password: string
  disabled?: boolean
}) {
  const loadModels = useThumbnailUpscalers()
  const models = loadModels.data

  if (!models) {
    return (
      <div className="flex gap-2">
        <Input
          id={id}
          placeholder="R-ESRGAN 4x+"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => loadModels.mutate({ url, username, password })}
          disabled={disabled || !url || loadModels.isPending}
        >
          {loadModels.isPending ? "Loading…" : "Load models"}
        </Button>
      </div>
    )
  }

  const customMode = !models.includes(value)

  return (
    <div className="flex gap-2">
      <Select
        value={customMode ? CUSTOM_UPSCALER : value}
        onValueChange={(v) => onChange(v === CUSTOM_UPSCALER ? "" : v)}
        disabled={disabled}
      >
        <SelectTrigger id={customMode ? undefined : id} className={customMode ? "w-40" : "flex-1"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_UPSCALER}>Custom…</SelectItem>
        </SelectContent>
      </Select>
      {customMode && (
        <Input
          id={id}
          placeholder="Model name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="flex-1"
        />
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => loadModels.mutate({ url, username, password })}
        disabled={disabled || !url || loadModels.isPending}
      >
        {loadModels.isPending ? "Loading…" : "Refresh"}
      </Button>
    </div>
  )
}

function toForm(s: Settings) {
  return {
    enabled: s.thumbnailEnhancementEnabled,
    url: s.thumbnailEnhancementUrl,
    username: s.thumbnailEnhancementUsername,
    password: s.thumbnailEnhancementPassword,
    upscaler: s.thumbnailEnhancementUpscaler,
    minDim: String(s.thumbnailEnhancementMinDim),
    targetMode: s.thumbnailEnhancementTargetMode,
    factor: s.thumbnailEnhancementFactor,
    targetDim: s.thumbnailEnhancementTargetDim,
    scheduleEnabled: s.thumbnailEnhancementScheduleEnabled,
    retentionDays: String(s.thumbnailEnhancementRetentionDays),
    autoApprove: s.thumbnailEnhancementAutoApprove,
    autoOnDownload: s.thumbnailEnhancementAutoOnDownload,
    maxPerSweep: s.thumbnailEnhancementMaxPerSweep,
  }
}

export function ThumbnailEnhancementTab() {
  return (
    <SettingsTabLoader skeletonClassName="h-40 w-full max-w-lg">
      {(settings) => <ThumbnailEnhancementTabBody settings={settings} />}
    </SettingsTabLoader>
  )
}

function ThumbnailEnhancementTabBody({ settings }: { settings: Settings }) {
  const updateSettings = useUpdateSettings()
  const clearThumbnailEnhancementHistory = useClearThumbnailEnhancementHistory()
  const { field, afterSave } = useSettingsDraft(settings, toForm)
  const [enabled, setEnabled] = field("enabled")
  const [url, setUrl] = field("url")
  const [username, setUsername] = field("username")
  const [password, setPassword] = field("password")
  const [upscaler, setUpscaler] = field("upscaler")
  const [minDim, setMinDim] = field("minDim")
  const [targetMode, setTargetMode] = field("targetMode")
  const [factor, setFactor] = field("factor")
  const [targetDim, setTargetDim] = field("targetDim")
  const [scheduleEnabled, setScheduleEnabled] = field("scheduleEnabled")
  const [retentionDays, setRetentionDays] = field("retentionDays")
  const [autoApprove, setAutoApprove] = field("autoApprove")
  const [autoOnDownload, setAutoOnDownload] = field("autoOnDownload")
  const [maxPerSweep, setMaxPerSweep] = field("maxPerSweep")

  const minDimNum = parseInt(minDim, 10)

  const payload: UpdateSettingsRequest = {}
  if (enabled !== settings.thumbnailEnhancementEnabled) payload.thumbnailEnhancementEnabled = enabled
  if (url !== settings.thumbnailEnhancementUrl) payload.thumbnailEnhancementUrl = url
  if (username !== settings.thumbnailEnhancementUsername) payload.thumbnailEnhancementUsername = username
  if (password !== settings.thumbnailEnhancementPassword) payload.thumbnailEnhancementPassword = password
  if (upscaler !== settings.thumbnailEnhancementUpscaler) payload.thumbnailEnhancementUpscaler = upscaler
  if (!isNaN(minDimNum) && minDimNum > 0 && minDimNum !== settings.thumbnailEnhancementMinDim) {
    payload.thumbnailEnhancementMinDim = minDimNum
  }
  if (targetMode !== settings.thumbnailEnhancementTargetMode) payload.thumbnailEnhancementTargetMode = targetMode
  if (factor !== settings.thumbnailEnhancementFactor) payload.thumbnailEnhancementFactor = factor
  if (targetDim !== settings.thumbnailEnhancementTargetDim) payload.thumbnailEnhancementTargetDim = targetDim
  if (scheduleEnabled !== settings.thumbnailEnhancementScheduleEnabled) {
    payload.thumbnailEnhancementScheduleEnabled = scheduleEnabled
  }
  const retention = Number(retentionDays)
  if (retention !== settings.thumbnailEnhancementRetentionDays) payload.thumbnailEnhancementRetentionDays = retention
  if (autoApprove !== settings.thumbnailEnhancementAutoApprove) payload.thumbnailEnhancementAutoApprove = autoApprove
  if (autoOnDownload !== settings.thumbnailEnhancementAutoOnDownload) {
    payload.thumbnailEnhancementAutoOnDownload = autoOnDownload
  }
  if (maxPerSweep !== settings.thumbnailEnhancementMaxPerSweep) {
    payload.thumbnailEnhancementMaxPerSweep = maxPerSweep
  }
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="flex min-h-full flex-col">
      <div className="max-w-3xl space-y-6 pb-6">
        <SettingsCard icon={Sparkles} title="AI Enhancement">
          <div className="max-w-lg space-y-4">
            <div className="flex items-center gap-1.5">
              <Checkbox id="thumb-enhance-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
              <Label htmlFor="thumb-enhance-enabled" className="font-normal">
                Enable AI thumbnail enhancement
              </Label>
              <InfoPopover>
                Upscales low-resolution library thumbnails using a local Stable Diffusion WebUI
                (AUTOMATIC1111-compatible) instance you run yourself — nothing is sent anywhere
                outside your own network. That instance must be started with the{" "}
                <code>--api</code> flag; if it also uses <code>--api-auth</code>, fill in the
                username/password below to match.
              </InfoPopover>
            </div>

            <div className="flex items-center gap-1.5">
              <Checkbox
                id="thumb-enhance-schedule-enabled"
                checked={scheduleEnabled}
                onCheckedChange={(v) => setScheduleEnabled(v === true)}
                disabled={!enabled}
              />
              <Label htmlFor="thumb-enhance-schedule-enabled" className="font-normal">
                Run automatically every hour
              </Label>
              <InfoPopover>
                Turn this off to only enhance thumbnails when you click "Enhance Now" on the AI
                Enhancement page — the feature stays available, it just never runs in the background.
              </InfoPopover>
            </div>

            <div className="flex items-center gap-1.5">
              <Checkbox
                id="thumb-enhance-auto-approve"
                checked={autoApprove}
                onCheckedChange={(v) => setAutoApprove(v === true)}
                disabled={!enabled}
              />
              <Label htmlFor="thumb-enhance-auto-approve" className="font-normal">
                Auto-approve enhanced thumbnails
              </Label>
              <InfoPopover>
                Skips saving the original thumbnail — the enhanced version just takes its place, with
                no Compare/Revert available for that item afterward. Applies to every enhancement,
                however it's triggered (manual, scheduled, or on new downloads).
              </InfoPopover>
            </div>

            <div className="flex items-center gap-1.5">
              <Checkbox
                id="thumb-enhance-auto-on-download"
                checked={autoOnDownload}
                onCheckedChange={(v) => setAutoOnDownload(v === true)}
                disabled={!enabled}
              />
              <Label htmlFor="thumb-enhance-auto-on-download" className="font-normal">
                Enhance new downloads automatically
              </Label>
              <InfoPopover>
                Enhances a freshly-downloaded item's thumbnail right after the download finishes, if
                it's below the minimum dimension below — no need to wait for the hourly sweep. Only
                applies to fresh downloads, not redownloads.
              </InfoPopover>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard
          icon={Server}
          title="Stable Diffusion connection"
          description="Loading models runs immediately; it is not part of Save."
        >
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <Label htmlFor="thumb-enhance-url">Stable Diffusion WebUI URL</Label>
              <Input
                id="thumb-enhance-url"
                placeholder="http://127.0.0.1:7860"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!enabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="thumb-enhance-username">Username</Label>
              <Input
                id="thumb-enhance-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={!enabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="thumb-enhance-password">Password</Label>
              <Input
                id="thumb-enhance-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!enabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="thumb-enhance-upscaler">Upscaler model</Label>
              <UpscalerField
                id="thumb-enhance-upscaler"
                value={upscaler}
                onChange={setUpscaler}
                url={url}
                username={username}
                password={password}
                disabled={!enabled}
              />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard icon={Maximize2} title="Upscaling">
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="thumb-enhance-target-mode"
                info="Multiply keeps the same aspect ratio scaled up by a fixed amount (e.g. 4x turns 480x270 into 1920x1080). Target size instead aims for a specific longest-side pixel count regardless of how small the original is, so a 240p and a 480p thumbnail both end up the same size."
              >
                Scaling
              </FieldLabel>
              <Select value={targetMode} onValueChange={(v) => setTargetMode(v as "factor" | "resolution")} disabled={!enabled}>
                <SelectTrigger id="thumb-enhance-target-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="factor">Multiply by a factor</SelectItem>
                  <SelectItem value="resolution">Scale to a target size</SelectItem>
                </SelectContent>
              </Select>
              {targetMode === "factor" ? (
                <PresetOrCustomNumberField
                  value={factor}
                  onChange={setFactor}
                  presets={[2, 3, 4]}
                  min={1}
                  disabled={!enabled}
                />
              ) : (
                <PresetOrCustomNumberField
                  value={targetDim}
                  onChange={setTargetDim}
                  presets={[1280, 1920, 2560, 3840]}
                  min={1}
                  disabled={!enabled}
                />
              )}
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="thumb-enhance-min-dim" info="A thumbnail is only enhanced if its longest side is below this many pixels — already-good thumbnails are left alone.">
                Minimum dimension (px)
              </FieldLabel>
              <PresetOrCustomNumberField
                id="thumb-enhance-min-dim"
                value={minDimNum || 0}
                onChange={(v) => setMinDim(String(v))}
                presets={[480, 720, 1080, 1440, 2160]}
                min={1}
                disabled={!enabled}
              />
            </div>

            <div className="space-y-2">
              <FieldLabel
                htmlFor="thumb-enhance-max-per-sweep"
                info="Caps how many thumbnails one batch run (a scheduled sweep or 'Enhance Now') processes at once, so a large backlog can't tie up a slow local upscaler indefinitely. Doesn't limit enhancing one specific item directly from the eligible-items dialog."
              >
                Max per batch run
              </FieldLabel>
              <PresetOrCustomNumberField
                id="thumb-enhance-max-per-sweep"
                value={maxPerSweep}
                onChange={setMaxPerSweep}
                presets={[5, 10, 20, 50]}
                min={1}
                disabled={!enabled}
              />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard icon={HistoryIcon} title="History">
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="thumb-enhance-retention"
                info="AI Enhancement history entries older than this are deleted automatically. Doesn't affect your library thumbnails — only the AI Enhancement page's history log (and, for an item's last remaining entry, its stored original backup)."
              >
                Keep history for
              </FieldLabel>
              <Select value={retentionDays} onValueChange={setRetentionDays}>
                <SelectTrigger id="thumb-enhance-retention" className="w-40">
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
                  <Button variant="outline" size="sm" disabled={clearThumbnailEnhancementHistory.isPending}>
                    Clear All History
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete all AI Enhancement history?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Removes every entry from the AI Enhancement page's history right now, and frees
                      every stored original-thumbnail backup along with it — Compare/Revert won't be
                      available for any item afterward. Doesn't affect current thumbnails.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => clearThumbnailEnhancementHistory.mutate()}>
                      Delete all
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <span className="text-xs text-muted-foreground">Runs immediately; not part of Save.</span>
            </div>
          </div>
        </SettingsCard>

        <p className="text-sm text-muted-foreground">
          Manually run enhancements and view history on the{" "}
          <Link to="/thumbnail-enhancement" className="underline underline-offset-2 hover:text-foreground">
            AI Enhancement page
          </Link>
          .
        </p>
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
