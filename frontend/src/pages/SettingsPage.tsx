import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
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
import { ThumbnailFrameRangeSlider } from "@/components/ThumbnailFrameRangeSlider"
import { RESOLUTION_STEP_LABELS } from "@/lib/resolution"
import { FieldLabel, InfoPopover } from "@/components/ui/info-popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PresetOrCustomNumberField } from "@/components/ui/preset-or-custom-number-field"
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
import { useScanMissingLibraryFiles } from "@/hooks/useLibrary"
import {
  useImageBackfillStatus,
  useRescanJellyfinLibrary,
  useSettings,
  useStartImageBackfill,
  useUpdateSettings,
  useUpdateYtDlp,
  useYtDlpVersion,
} from "@/hooks/useSettings"
import { useClearThumbnailEnhancementHistory, useThumbnailUpscalers } from "@/hooks/useThumbnailEnhancement"
import { useAccentColor, type AccentColor } from "@/hooks/useAccentColor"
import { useDesktopNotifications } from "@/hooks/useDesktopNotifications"
import type { DownloadType, UpdateSettingsRequest, VideoQuality } from "@/types/api"

const ACCENT_COLOR_OPTIONS: { value: AccentColor; label: string; swatch: string }[] = [
  { value: "default", label: "Default", swatch: "oklch(0.534 0.288 293)" },
  { value: "blue", label: "Blue", swatch: "oklch(0.55 0.2 260)" },
  { value: "red", label: "Red", swatch: "oklch(0.55 0.22 10)" },
  { value: "green", label: "Green", swatch: "oklch(0.55 0.17 145)" },
  { value: "violet", label: "Violet", swatch: "oklch(0.55 0.22 300)" },
]

const VIDEO_QUALITIES: VideoQuality[] = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"]

// Radix Select disallows an empty-string item value, so "none" is used as
// the sentinel for "no cookies browser configured" and translated back to
// "" on save — same trick used by FilenameTemplateBuilderDialog's NO_MODIFIER.
const NO_COOKIES_BROWSER = "none"
const YTDLP_COOKIE_BROWSERS = ["brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale"] as const

const SETTINGS_TABS = [
  "general",
  "account",
  "downloads",
  "library",
  "privacy",
  "history",
  "backup",
  "jellyfin",
  "notifications",
  "ai-enhance",
  "ytdlp",
  "appearance",
] as const

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get("tab")
  const activeTab = (SETTINGS_TABS as readonly string[]).includes(tabParam ?? "") ? tabParam! : "general"

  const setActiveTab = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === "general") next.delete("tab")
    else next.set("tab", value)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="flex h-full flex-col space-y-6">
      <h1 className="shrink-0 text-2xl font-semibold">Settings</h1>

      {/* min-h-0 lets this flex child actually shrink below its content
          height — without it, the flex-1 content pane below can't establish
          a bounded height to scroll within, and just grows the whole page
          instead (a classic flexbox-overflow gotcha). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1">
          <TabsList className="shrink-0 px-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="downloads">Downloads</TabsTrigger>
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="privacy">Privacy</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="backup">Backup</TabsTrigger>
            <TabsTrigger value="jellyfin">Jellyfin</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="ai-enhance">AI Enhancement</TabsTrigger>
            <TabsTrigger value="ytdlp">yt-dlp</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <TabsContent value="general" className="mt-0 h-full">
              <GeneralTab />
            </TabsContent>
            <TabsContent value="account" className="mt-0 h-full">
              <AccountTab />
            </TabsContent>
            <TabsContent value="downloads" className="mt-0 h-full">
              <DownloadsTab />
            </TabsContent>
            <TabsContent value="library" className="mt-0 h-full">
              <LibraryTab />
            </TabsContent>
            <TabsContent value="privacy" className="mt-0 h-full">
              <PrivacyTab />
            </TabsContent>
            <TabsContent value="history" className="mt-0 h-full">
              <HistoryTab />
            </TabsContent>
            <TabsContent value="backup" className="mt-0 h-full">
              <BackupTab />
            </TabsContent>
            <TabsContent value="jellyfin" className="mt-0 h-full">
              <JellyfinTab />
            </TabsContent>
            <TabsContent value="notifications" className="mt-0 h-full">
              <NotificationsTab />
            </TabsContent>
            <TabsContent value="ai-enhance" className="mt-0 h-full">
              <ThumbnailEnhancementTab />
            </TabsContent>
            <TabsContent value="ytdlp" className="mt-0 h-full">
              <YtDlpTab />
            </TabsContent>
            <TabsContent value="appearance" className="mt-0 h-full">
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
    <div className="sticky -bottom-6 -mx-6 -mb-6 mt-auto flex items-center gap-3 border-t bg-card px-6 py-4">
      <Button onClick={onSave} disabled={!dirty || isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
      <span
        className={cn(
          "text-xs",
          dirty ? "text-warning" : isSuccess ? "text-success" : "text-muted-foreground",
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
  const [maxConcurrentTranscodes, setMaxConcurrentTranscodes] = useState("")
  const [downloadTimeout, setDownloadTimeout] = useState("")

  useEffect(() => {
    if (!settings) return
    setMaxConcurrent(String(settings.maxConcurrentDownloads))
    setMaxConcurrentTranscodes(String(settings.maxConcurrentTranscodes))
    setDownloadTimeout(String(settings.downloadTimeoutMinutes))
  }, [settings])

  if (isLoading || !settings) return <Skeleton className="h-24 w-full max-w-lg" />

  const payload: UpdateSettingsRequest = {}
  const n = Number(maxConcurrent)
  if (n > 0 && n !== settings.maxConcurrentDownloads) payload.maxConcurrentDownloads = n
  const nTranscodes = Number(maxConcurrentTranscodes)
  if (nTranscodes > 0 && nTranscodes !== settings.maxConcurrentTranscodes) payload.maxConcurrentTranscodes = nTranscodes
  const timeout = Number(downloadTimeout)
  if (timeout >= 0 && timeout !== settings.downloadTimeoutMinutes) payload.downloadTimeoutMinutes = timeout
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="flex min-h-full flex-col space-y-4">
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
    <div className="flex min-h-full flex-col space-y-4">
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

// Its own tab (rather than living under Downloads, where it started) since
// desktop notifications aren't download-specific — the same toggle governs
// any future notification-worthy event, not just a download finishing.
function NotificationsTab() {
  const { enabled: desktopNotifications, setEnabled: setDesktopNotifications } = useDesktopNotifications()

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-1.5">
        <Checkbox
          id="desktop-notifications"
          checked={desktopNotifications}
          onCheckedChange={(v) => setDesktopNotifications(v === true)}
        />
        <Label htmlFor="desktop-notifications" className="font-normal">
          Desktop notifications
        </Label>
        <InfoPopover>
          Shows a browser/OS notification for notification-worthy events (currently: a download
          completing/failing/being cancelled, a thumbnail finishing AI Enhancement, a Frame Match
          being found, a scheduled subscription check finding new items, or a scheduled backup
          failing) — on top of the in-app toast, which always shows regardless of this setting
          for downloads (the rest skip the toast and use only the desktop notification — either
          because they already show live status on their own page, like Enhancement/Frame Match,
          or because a manual trigger of the same action already gets synchronous feedback, like
          "Check now"/a manual backup). Only fires while you're away from this tab (it's
          backgrounded, minimized, or the window isn't focused) — the toast already covers the
          case where you're looking at it. A personal per-browser preference (like Theme), not
          synced across devices. Turning this on prompts for
          notification permission if you haven't granted or denied it yet.
        </InfoPopover>
      </div>
    </div>
  )
}

const FRAME_COUNT_OPTIONS = [2, 4, 6, 8, 12, 24]

function LibraryTab() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const { data: backfillStatus } = useImageBackfillStatus()
  const startBackfill = useStartImageBackfill()
  const scanMissing = useScanMissingLibraryFiles()

  const [mediumEnabled, setMediumEnabled] = useState(true)
  const [low, setLow] = useState(720)
  const [high, setHigh] = useState(2160)
  const [thumbMediumEnabled, setThumbMediumEnabled] = useState(true)
  const [thumbLow, setThumbLow] = useState(480)
  const [thumbHigh, setThumbHigh] = useState(1080)
  const [frameCount, setFrameCount] = useState(4)
  const [frameRangeLow, setFrameRangeLow] = useState(5)
  const [frameRangeHigh, setFrameRangeHigh] = useState(100)
  const [autoplay, setAutoplay] = useState(false)
  const [imageConvertFormat, setImageConvertFormat] = useState<"original" | "jpg" | "png" | "webp">("jpg")

  useEffect(() => {
    if (!settings) return
    setMediumEnabled(settings.resolutionTierMediumEnabled)
    setLow(settings.resolutionThresholdLow)
    setHigh(settings.resolutionThresholdHigh)
    setThumbMediumEnabled(settings.thumbnailResolutionTierMediumEnabled)
    setThumbLow(settings.thumbnailResolutionThresholdLow)
    setThumbHigh(settings.thumbnailResolutionThresholdHigh)
    setFrameCount(settings.thumbnailFrameCount)
    setFrameRangeLow(settings.thumbnailFrameRangeLow)
    setFrameRangeHigh(settings.thumbnailFrameRangeHigh)
    setAutoplay(settings.libraryAutoplay)
    setImageConvertFormat(settings.imageConvertFormat)
  }, [settings])

  if (isLoading || !settings) return <Skeleton className="h-40 w-full max-w-lg" />

  const payload: UpdateSettingsRequest = {}
  if (mediumEnabled !== settings.resolutionTierMediumEnabled) payload.resolutionTierMediumEnabled = mediumEnabled
  if (low !== settings.resolutionThresholdLow) payload.resolutionThresholdLow = low
  if (high !== settings.resolutionThresholdHigh) payload.resolutionThresholdHigh = high
  if (thumbMediumEnabled !== settings.thumbnailResolutionTierMediumEnabled)
    payload.thumbnailResolutionTierMediumEnabled = thumbMediumEnabled
  if (thumbLow !== settings.thumbnailResolutionThresholdLow) payload.thumbnailResolutionThresholdLow = thumbLow
  if (thumbHigh !== settings.thumbnailResolutionThresholdHigh) payload.thumbnailResolutionThresholdHigh = thumbHigh
  if (frameCount !== settings.thumbnailFrameCount) payload.thumbnailFrameCount = frameCount
  if (frameRangeLow !== settings.thumbnailFrameRangeLow) payload.thumbnailFrameRangeLow = frameRangeLow
  if (frameRangeHigh !== settings.thumbnailFrameRangeHigh) payload.thumbnailFrameRangeHigh = frameRangeHigh
  if (autoplay !== settings.libraryAutoplay) payload.libraryAutoplay = autoplay
  if (imageConvertFormat !== settings.imageConvertFormat) payload.imageConvertFormat = imageConvertFormat
  const dirty = Object.keys(payload).length > 0

  const lowLabel = RESOLUTION_STEP_LABELS[low] ?? `${low}p`
  const highLabel = RESOLUTION_STEP_LABELS[high] ?? `${high}p`
  const thumbLowLabel = RESOLUTION_STEP_LABELS[thumbLow] ?? `${thumbLow}p`
  const thumbHighLabel = RESOLUTION_STEP_LABELS[thumbHigh] ?? `${thumbHigh}p`

  return (
    <div className="flex min-h-full flex-col space-y-4">
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

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center gap-1.5">
          <Label>Library maintenance</Label>
          <InfoPopover>
            Checks every non-ghost item's file against disk and converts any that are missing
            (deleted, moved, or renamed outside the app) into ghost placeholders — the DB row,
            tags, and metadata are kept, "Download now" fills it back in. On-demand only, not
            scheduled.
          </InfoPopover>
        </div>
        <Button variant="outline" onClick={() => scanMissing.mutate()} disabled={scanMissing.isPending}>
          {scanMissing.isPending ? "Scanning…" : "Scan for Missing Files"}
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

      <div className="space-y-4 border-t pt-4">
        <h3 className="text-sm font-medium">Thumbnails</h3>
        <div className="space-y-2">
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

        <div className="space-y-1.5">
          <FieldLabel
            htmlFor="thumbnail-frame-range-slider"
            info="Which portion of the video, by duration, candidate frames are picked from. Narrowing this away from the default skips more of the intro/outro; the low end defaults to 5% to avoid a likely-blank opening frame."
          >
            "Choose from Video" pick range
          </FieldLabel>
          <ThumbnailFrameRangeSlider
            low={frameRangeLow}
            high={frameRangeHigh}
            onCommit={(newLow, newHigh) => {
              setFrameRangeLow(newLow)
              setFrameRangeHigh(newHigh)
            }}
          />
          <p className="text-xs text-muted-foreground">
            {frameRangeLow}% – {frameRangeHigh}% of the video's duration
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="thumbnail-resolution-medium-enabled"
              checked={thumbMediumEnabled}
              onCheckedChange={(v) => setThumbMediumEnabled(v === true)}
            />
            <Label htmlFor="thumbnail-resolution-medium-enabled" className="font-normal">
              Use medium tier
            </Label>
            <InfoPopover>
              When off, thumbnail resolution is split into just low/high. The medium threshold
              is kept (not discarded) so turning this back on restores it.
            </InfoPopover>
          </div>

          <div className="space-y-1.5">
            <FieldLabel
              htmlFor="thumbnail-resolution-tier-slider"
              info="Colors the Thumbnail resolution value in Library's Details mode according to which tier a thumbnail's resolution falls into. Separate from the video tiers above — thumbnails rarely exceed 1080p, so the defaults are lower."
            >
              Thumbnail quality tiers
            </FieldLabel>
            <ResolutionTierSlider
              mediumEnabled={thumbMediumEnabled}
              low={thumbLow}
              high={thumbHigh}
              onCommit={(newLow, newHigh) => {
                setThumbLow(newLow)
                setThumbHigh(newHigh)
              }}
            />
            <p className="text-xs text-muted-foreground">
              {thumbMediumEnabled
                ? `Low: ≤${thumbLowLabel} · Medium: ${thumbLowLabel}–${thumbHighLabel} · High: ≥${thumbHighLabel}`
                : `Low: <${thumbHighLabel} · High: ≥${thumbHighLabel}`}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-medium">Images</h3>
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
    <div className="flex min-h-full flex-col space-y-4">
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
    <div className="flex min-h-full flex-col space-y-4">
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
    <div className="flex min-h-full flex-col space-y-4">
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
    <div className="flex min-h-full flex-col space-y-4">
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

function ThumbnailEnhancementTab() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const clearThumbnailEnhancementHistory = useClearThumbnailEnhancementHistory()

  const [enabled, setEnabled] = useState(false)
  const [url, setUrl] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [upscaler, setUpscaler] = useState("")
  const [minDim, setMinDim] = useState("")
  const [targetMode, setTargetMode] = useState<"factor" | "resolution">("factor")
  const [factor, setFactor] = useState(4)
  const [targetDim, setTargetDim] = useState(1920)
  const [scheduleEnabled, setScheduleEnabled] = useState(true)
  const [retentionDays, setRetentionDays] = useState("0")
  const [autoApprove, setAutoApprove] = useState(false)
  const [autoOnDownload, setAutoOnDownload] = useState(false)
  const [maxPerSweep, setMaxPerSweep] = useState(5)

  useEffect(() => {
    if (!settings) return
    setEnabled(settings.thumbnailEnhancementEnabled)
    setUrl(settings.thumbnailEnhancementUrl)
    setUsername(settings.thumbnailEnhancementUsername)
    setPassword(settings.thumbnailEnhancementPassword)
    setUpscaler(settings.thumbnailEnhancementUpscaler)
    setMinDim(String(settings.thumbnailEnhancementMinDim))
    setTargetMode(settings.thumbnailEnhancementTargetMode)
    setFactor(settings.thumbnailEnhancementFactor)
    setTargetDim(settings.thumbnailEnhancementTargetDim)
    setScheduleEnabled(settings.thumbnailEnhancementScheduleEnabled)
    setRetentionDays(String(settings.thumbnailEnhancementRetentionDays))
    setAutoApprove(settings.thumbnailEnhancementAutoApprove)
    setAutoOnDownload(settings.thumbnailEnhancementAutoOnDownload)
    setMaxPerSweep(settings.thumbnailEnhancementMaxPerSweep)
  }, [settings])

  if (isLoading || !settings) return <Skeleton className="h-40 w-full max-w-lg" />

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
    <div className="flex min-h-full flex-col space-y-4">
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
    <div className="flex min-h-full flex-col space-y-4">
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
        </div>
      )}
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

function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  const { accent, setAccent } = useAccentColor()

  return (
    <div className="max-w-lg space-y-6">
      <div className="space-y-2">
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
      <div className="space-y-2">
        <Label>Primary color</Label>
        <Select value={accent} onValueChange={(v) => setAccent(v as AccentColor)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACCENT_COLOR_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: opt.swatch }}
                  />
                  {opt.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
