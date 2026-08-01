import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ResolutionTierSlider } from "@/components/ResolutionTierSlider"
import { RESOLUTION_STEP_LABELS } from "@/lib/resolution"
import { FieldLabel, InfoPopover } from "@/components/ui/info-popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useChangePassword } from "@/hooks/useAuth"
import { useClearDownloadLog } from "@/hooks/useDownloads"
import { useClearHistory } from "@/hooks/useHistory"
import {
  useImageBackfillStatus,
  useRescanJellyfinLibrary,
  useSettings,
  useStartImageBackfill,
  useUpdateSettings,
  useUpdateYtDlp,
  useYtDlpVersion,
} from "@/hooks/useSettings"
import type { DownloadType, UpdateSettingsRequest, VideoQuality } from "@/types/api"

const VIDEO_QUALITIES: VideoQuality[] = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"]

// Radix Select disallows an empty-string item value, so "none" is used as
// the sentinel for "no cookies browser configured" and translated back to
// "" on save — same trick used by FilenameTemplateBuilderDialog's NO_MODIFIER.
const NO_COOKIES_BROWSER = "none"
const YTDLP_COOKIE_BROWSERS = ["brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale"] as const

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Tabs defaultValue="general">
          <TabsList className="px-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="downloads">Downloads</TabsTrigger>
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="privacy">Privacy</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="backup">Backup</TabsTrigger>
            <TabsTrigger value="jellyfin">Jellyfin</TabsTrigger>
            <TabsTrigger value="ytdlp">yt-dlp</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>

          <div className="p-6">
            <TabsContent value="general" className="mt-0">
              <GeneralTab />
            </TabsContent>
            <TabsContent value="account" className="mt-0">
              <AccountTab />
            </TabsContent>
            <TabsContent value="downloads" className="mt-0">
              <DownloadsTab />
            </TabsContent>
            <TabsContent value="library" className="mt-0">
              <LibraryTab />
            </TabsContent>
            <TabsContent value="privacy" className="mt-0">
              <PrivacyTab />
            </TabsContent>
            <TabsContent value="history" className="mt-0">
              <HistoryTab />
            </TabsContent>
            <TabsContent value="backup" className="mt-0">
              <BackupTab />
            </TabsContent>
            <TabsContent value="jellyfin" className="mt-0">
              <JellyfinTab />
            </TabsContent>
            <TabsContent value="ytdlp" className="mt-0">
              <YtDlpTab />
            </TabsContent>
            <TabsContent value="appearance" className="mt-0">
              <AppearanceTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  )
}

// The single Save control every buffered tab ends with — button plus a
// status word ("No changes" / "Unsaved changes" / "Saved") so it's obvious
// at a glance whether anything you touched has actually been applied yet.
// Unrelated actions (Clear all now, Rescan Library Now) are NOT slotted in
// here — they aren't gated by Save, so they get their own row underneath
// instead of implying they're part of the same buffered-edit flow.
function SaveRow({
  dirty,
  isPending,
  isSuccess,
  onSave,
}: {
  dirty: boolean
  isPending: boolean
  isSuccess: boolean
  onSave: () => void
}) {
  const status = dirty ? "Unsaved changes" : isSuccess ? "Saved" : "No changes"
  return (
    <div className="flex items-center gap-3 border-t pt-4">
      <Button onClick={onSave} disabled={!dirty || isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
      <span
        className={cn(
          "text-xs",
          dirty ? "text-amber-600 dark:text-amber-500" : isSuccess ? "text-green-600 dark:text-green-500" : "text-muted-foreground",
        )}
      >
        {status}
      </span>
    </div>
  )
}

function GeneralTab() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  const [maxConcurrent, setMaxConcurrent] = useState("")
  const [downloadTimeout, setDownloadTimeout] = useState("")

  useEffect(() => {
    if (!settings) return
    setMaxConcurrent(String(settings.maxConcurrentDownloads))
    setDownloadTimeout(String(settings.downloadTimeoutMinutes))
  }, [settings])

  if (isLoading || !settings) return <Skeleton className="h-24 w-full max-w-lg" />

  const payload: UpdateSettingsRequest = {}
  const n = Number(maxConcurrent)
  if (n > 0 && n !== settings.maxConcurrentDownloads) payload.maxConcurrentDownloads = n
  const timeout = Number(downloadTimeout)
  if (timeout >= 0 && timeout !== settings.downloadTimeoutMinutes) payload.downloadTimeoutMinutes = timeout
  const dirty = Object.keys(payload).length > 0

  return (
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

      <div className="space-y-2">
        <Label htmlFor="max-concurrent">Max Concurrent Downloads</Label>
        <Input
          id="max-concurrent"
          type="number"
          min="1"
          value={maxConcurrent}
          onChange={(e) => setMaxConcurrent(e.target.value)}
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

      <SaveRow
        dirty={dirty}
        isPending={updateSettings.isPending}
        isSuccess={updateSettings.isSuccess}
        onSave={() => updateSettings.mutate(payload)}
      />
    </div>
  )
}

function AccountTab() {
  const changePassword = useChangePassword()

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  const canSubmit = currentPassword.length > 0 && newPassword.length >= 8 && !mismatch

  const handleSubmit = () => {
    if (!canSubmit) return
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("")
          setNewPassword("")
          setConfirmPassword("")
        },
      },
    )
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="space-y-2">
        <Label htmlFor="current-password">Current Password</Label>
        <Input
          id="current-password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-password">New Password</Label>
        <Input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm New Password</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {mismatch && <p className="text-xs text-destructive">Passwords don't match</p>}
      </div>
      <Button onClick={handleSubmit} disabled={!canSubmit || changePassword.isPending}>
        {changePassword.isPending ? "Saving…" : "Change Password"}
      </Button>
    </div>
  )
}

const RETENTION_OPTIONS: { value: string; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "365 days" },
  { value: "0", label: "Forever" },
]

function DownloadsTab() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const clearDownloadLog = useClearDownloadLog()

  const [defaultQuality, setDefaultQuality] = useState<VideoQuality>("best")
  const [defaultDownloadType, setDefaultDownloadType] = useState<DownloadType>("video")
  const [skipDownloadPreview, setSkipDownloadPreview] = useState(false)
  const [logRetentionDays, setLogRetentionDays] = useState("7")

  useEffect(() => {
    if (!settings) return
    setDefaultQuality(settings.defaultQuality as VideoQuality)
    setDefaultDownloadType(settings.defaultDownloadType)
    setSkipDownloadPreview(settings.skipDownloadPreview)
    setLogRetentionDays(String(settings.downloadLogRetentionDays))
  }, [settings])

  if (isLoading || !settings) return <Skeleton className="h-24 w-full max-w-lg" />

  const payload: UpdateSettingsRequest = {}
  if (defaultQuality !== settings.defaultQuality) payload.defaultQuality = defaultQuality
  if (defaultDownloadType !== settings.defaultDownloadType) payload.defaultDownloadType = defaultDownloadType
  if (skipDownloadPreview !== settings.skipDownloadPreview) payload.skipDownloadPreview = skipDownloadPreview
  const retention = Number(logRetentionDays)
  if (retention !== settings.downloadLogRetentionDays) payload.downloadLogRetentionDays = retention
  const dirty = Object.keys(payload).length > 0

  return (
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

      <SaveRow
        dirty={dirty}
        isPending={updateSettings.isPending}
        isSuccess={updateSettings.isSuccess}
        onSave={() => updateSettings.mutate(payload)}
      />
    </div>
  )
}

const FRAME_COUNT_OPTIONS = [2, 4, 6, 8]

function LibraryTab() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const { data: backfillStatus } = useImageBackfillStatus()
  const startBackfill = useStartImageBackfill()

  const [mediumEnabled, setMediumEnabled] = useState(true)
  const [low, setLow] = useState(720)
  const [high, setHigh] = useState(2160)
  const [frameCount, setFrameCount] = useState(4)
  const [autoplay, setAutoplay] = useState(false)

  useEffect(() => {
    if (!settings) return
    setMediumEnabled(settings.resolutionTierMediumEnabled)
    setLow(settings.resolutionThresholdLow)
    setHigh(settings.resolutionThresholdHigh)
    setFrameCount(settings.thumbnailFrameCount)
    setAutoplay(settings.libraryAutoplay)
  }, [settings])

  if (isLoading || !settings) return <Skeleton className="h-40 w-full max-w-lg" />

  const payload: UpdateSettingsRequest = {}
  if (mediumEnabled !== settings.resolutionTierMediumEnabled) payload.resolutionTierMediumEnabled = mediumEnabled
  if (low !== settings.resolutionThresholdLow) payload.resolutionThresholdLow = low
  if (high !== settings.resolutionThresholdHigh) payload.resolutionThresholdHigh = high
  if (frameCount !== settings.thumbnailFrameCount) payload.thumbnailFrameCount = frameCount
  if (autoplay !== settings.libraryAutoplay) payload.libraryAutoplay = autoplay
  const dirty = Object.keys(payload).length > 0

  const lowLabel = RESOLUTION_STEP_LABELS[low] ?? `${low}p`
  const highLabel = RESOLUTION_STEP_LABELS[high] ?? `${high}p`

  return (
    <div className="max-w-lg space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label>Image derivatives</Label>
          <InfoPopover>
            Generates small/medium-size versions of library thumbnails, artist images, and
            collection covers, so most of the app loads a much smaller file instead of the
            original. Only needed once for items that predate this feature (or after resetting
            the images folder) — anything downloaded or edited afterward gets this
            automatically. Independent of the settings below — runs immediately, not part of
            Save.
          </InfoPopover>
        </div>
        {backfillStatus?.running ? (
          <p className="text-sm text-muted-foreground">
            Running… library {backfillStatus.libraryProcessed} processed
            {backfillStatus.libraryFailed > 0 ? ` (${backfillStatus.libraryFailed} failed)` : ""}, artists{" "}
            {backfillStatus.artistProcessed} processed
            {backfillStatus.artistFailed > 0 ? ` (${backfillStatus.artistFailed} failed)` : ""}, covers{" "}
            {backfillStatus.coverProcessed} processed
            {backfillStatus.coverFailed > 0 ? ` (${backfillStatus.coverFailed} failed)` : ""}.
          </p>
        ) : backfillStatus?.finishedAt ? (
          <p className="text-sm text-muted-foreground">
            Last run: library {backfillStatus.libraryProcessed}/{backfillStatus.libraryFailed} failed, artists{" "}
            {backfillStatus.artistProcessed}/{backfillStatus.artistFailed} failed, covers{" "}
            {backfillStatus.coverProcessed}/{backfillStatus.coverFailed} failed.
          </p>
        ) : null}
        <Button
          variant="outline"
          onClick={() => startBackfill.mutate()}
          disabled={startBackfill.isPending || backfillStatus?.running}
        >
          {backfillStatus?.running ? "Running…" : "Backfill Images"}
        </Button>
      </div>

      <div className="space-y-4 border-t pt-4">
        <h3 className="text-sm font-medium">Resolution tiers</h3>
        <div className="flex items-center gap-1.5">
          <Checkbox id="resolution-medium-enabled" checked={mediumEnabled} onCheckedChange={(v) => setMediumEnabled(v === true)} />
          <Label htmlFor="resolution-medium-enabled" className="font-normal">
            Use medium tier
          </Label>
          <InfoPopover>
            When off, resolution is split into just low/high. The medium threshold is kept
            (not discarded) so turning this back on restores it.
          </InfoPopover>
        </div>

        <div className="space-y-1.5">
          <FieldLabel
            htmlFor="resolution-tier-slider"
            info="Colors the Resolution value in Library's Details mode, Compare Metadata, and the New Download preview according to which tier a file's resolution falls into."
          >
            Quality tiers
          </FieldLabel>
          <ResolutionTierSlider
            mediumEnabled={mediumEnabled}
            low={low}
            high={high}
            onCommit={(newLow, newHigh) => {
              setLow(newLow)
              setHigh(newHigh)
            }}
          />
          <p className="text-xs text-muted-foreground">
            {mediumEnabled
              ? `Low: ≤${lowLabel} · Medium: ${lowLabel}–${highLabel} · High: ≥${highLabel}`
              : `Low: <${highLabel} · High: ≥${highLabel}`}
          </p>
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-medium">Thumbnails</h3>
        <FieldLabel
          htmlFor="thumbnail-frame-count"
          info="How many frame options to offer when picking a thumbnail from a video."
        >
          "Choose from Video" frame count
        </FieldLabel>
        <Select value={String(frameCount)} onValueChange={(v) => setFrameCount(Number(v))}>
          <SelectTrigger id="thumbnail-frame-count" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FRAME_COUNT_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-medium">Player</h3>
        <div className="flex items-center gap-1.5">
          <Checkbox id="library-autoplay" checked={autoplay} onCheckedChange={(v) => setAutoplay(v === true)} />
          <Label htmlFor="library-autoplay" className="font-normal">
            Autoplay
          </Label>
          <InfoPopover>
            Starts playback immediately when opening a library item — including a private one,
            right after you reveal it. Volume is remembered automatically between plays.
          </InfoPopover>
        </div>
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

const BLUR_STRENGTH_OPTIONS: { value: string; label: string }[] = [
  { value: "weak", label: "Weak" },
  { value: "default", label: "Default" },
  { value: "strong", label: "Strong" },
]

function PrivacyTab() {
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

      <SaveRow
        dirty={dirty}
        isPending={updateSettings.isPending}
        isSuccess={updateSettings.isSuccess}
        onSave={() => updateSettings.mutate(payload)}
      />
    </div>
  )
}

function HistoryTab() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const clearHistory = useClearHistory()

  const [anonymize, setAnonymize] = useState(false)
  const [retentionDays, setRetentionDays] = useState("7")

  useEffect(() => {
    if (!settings) return
    setAnonymize(settings.historyAnonymizeUrls)
    setRetentionDays(String(settings.historyRetentionDays))
  }, [settings])

  if (isLoading || !settings) return <Skeleton className="h-20 w-full max-w-lg" />

  const payload: UpdateSettingsRequest = {}
  if (anonymize !== settings.historyAnonymizeUrls) payload.historyAnonymizeUrls = anonymize
  const retention = Number(retentionDays)
  if (retention !== settings.historyRetentionDays) payload.historyRetentionDays = retention
  const dirty = Object.keys(payload).length > 0

  return (
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

      <SaveRow
        dirty={dirty}
        isPending={updateSettings.isPending}
        isSuccess={updateSettings.isSuccess}
        onSave={() => updateSettings.mutate(payload)}
      />
    </div>
  )
}

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

function BackupTab() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  const [intervalHours, setIntervalHours] = useState("0")
  const [retentionCount, setRetentionCount] = useState("30")

  useEffect(() => {
    if (!settings) return
    setIntervalHours(String(settings.autoBackupIntervalHours))
    setRetentionCount(String(settings.backupRetentionCount))
  }, [settings])

  if (isLoading || !settings) return <Skeleton className="h-16 w-full max-w-lg" />

  const payload: UpdateSettingsRequest = {}
  const interval = Number(intervalHours)
  if (interval !== settings.autoBackupIntervalHours) payload.autoBackupIntervalHours = interval
  const retention = Number(retentionCount)
  if (retention !== settings.backupRetentionCount) payload.backupRetentionCount = retention
  const dirty = Object.keys(payload).length > 0

  return (
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

      <SaveRow
        dirty={dirty}
        isPending={updateSettings.isPending}
        isSuccess={updateSettings.isSuccess}
        onSave={() => updateSettings.mutate(payload)}
      />
    </div>
  )
}

function JellyfinTab() {
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

      <Button
        variant="outline"
        onClick={() => rescan.mutate()}
        disabled={!enabled || !url || !apiKey || rescan.isPending}
      >
        {rescan.isPending ? "Rescanning…" : "Rescan Library Now"}
      </Button>

      <SaveRow
        dirty={dirty}
        isPending={updateSettings.isPending}
        isSuccess={updateSettings.isSuccess}
        onSave={() => updateSettings.mutate(payload)}
      />
    </div>
  )
}

function YtDlpTab() {
  const { data, isLoading } = useYtDlpVersion()
  const update = useUpdateYtDlp()
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  const [cookiesBrowser, setCookiesBrowser] = useState(NO_COOKIES_BROWSER)
  const [cookiesProfile, setCookiesProfile] = useState("")
  const [proxy, setProxy] = useState("")
  const [rateLimit, setRateLimit] = useState("")
  const [retries, setRetries] = useState("")

  useEffect(() => {
    if (!settings) return
    setCookiesBrowser(settings.ytdlpCookiesBrowser || NO_COOKIES_BROWSER)
    setCookiesProfile(settings.ytdlpCookiesProfile)
    setProxy(settings.ytdlpProxy)
    setRateLimit(settings.ytdlpRateLimit)
    setRetries(settings.ytdlpRetries > 0 ? String(settings.ytdlpRetries) : "")
  }, [settings])

  let payload: UpdateSettingsRequest = {}
  if (settings) {
    const browserValue = cookiesBrowser === NO_COOKIES_BROWSER ? "" : cookiesBrowser
    if (browserValue !== settings.ytdlpCookiesBrowser) payload.ytdlpCookiesBrowser = browserValue
    if (cookiesProfile !== settings.ytdlpCookiesProfile) payload.ytdlpCookiesProfile = cookiesProfile
    if (proxy !== settings.ytdlpProxy) payload.ytdlpProxy = proxy
    if (rateLimit !== settings.ytdlpRateLimit) payload.ytdlpRateLimit = rateLimit
    const retriesValue = retries.trim() === "" ? 0 : Number(retries)
    if (!Number.isNaN(retriesValue) && retriesValue !== settings.ytdlpRetries) payload.ytdlpRetries = retriesValue
  }
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="max-w-lg space-y-4">
      {isLoading || !data ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <>
          <div className="space-y-1 text-sm">
            <p>
              Current version: <span className="font-mono">{data.currentVersion}</span>
            </p>
            {data.updateAvailable ? (
              <p className="text-amber-600">
                Update available: <span className="font-mono">{data.latestVersion}</span>
              </p>
            ) : (
              <p className="text-muted-foreground">
                Up to date{data.latestVersion ? "" : " (couldn't check latest)"}.
              </p>
            )}
          </div>
          <Button variant="outline" onClick={() => update.mutate()} disabled={update.isPending}>
            {update.isPending ? "Updating…" : "Update yt-dlp"}
          </Button>
        </>
      )}

      {settingsLoading || !settings ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-4 border-t pt-4">
          <div className="space-y-2">
            <FieldLabel
              htmlFor="ytdlp-cookies-browser"
              info="Reads cookies directly from an installed browser's profile — useful for members-only or age-gated videos."
            >
              Cookies browser
            </FieldLabel>
            <Select value={cookiesBrowser} onValueChange={setCookiesBrowser}>
              <SelectTrigger id="ytdlp-cookies-browser" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COOKIES_BROWSER}>None</SelectItem>
                {YTDLP_COOKIE_BROWSERS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b[0].toUpperCase() + b.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ytdlp-cookies-profile">Profile (optional)</Label>
            <Input
              id="ytdlp-cookies-profile"
              placeholder="e.g. Default"
              value={cookiesProfile}
              onChange={(e) => setCookiesProfile(e.target.value)}
              disabled={cookiesBrowser === NO_COOKIES_BROWSER}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ytdlp-proxy">Proxy</Label>
            <Input
              id="ytdlp-proxy"
              placeholder="e.g. socks5://127.0.0.1:1080"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ytdlp-rate-limit">Rate limit</Label>
              <Input
                id="ytdlp-rate-limit"
                placeholder="e.g. 500K"
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ytdlp-retries">Retries</Label>
              <Input
                id="ytdlp-retries"
                type="number"
                min="0"
                placeholder="10 (yt-dlp default)"
                value={retries}
                onChange={(e) => setRetries(e.target.value)}
              />
            </div>
          </div>

          <SaveRow
            dirty={dirty}
            isPending={updateSettings.isPending}
            isSuccess={updateSettings.isSuccess}
            onSave={() => updateSettings.mutate(payload)}
          />
        </div>
      )}
    </div>
  )
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="max-w-lg space-y-2">
      <Label>Theme</Label>
      <Select value={theme ?? "system"} onValueChange={setTheme}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
          <SelectItem value="system">System</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
