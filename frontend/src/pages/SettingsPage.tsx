import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { useChangePassword } from "@/hooks/useAuth"
import { useRescanJellyfinLibrary, useSettings, useUpdateSettings } from "@/hooks/useSettings"
import type { DownloadType, UpdateSettingsRequest, VideoQuality } from "@/types/api"

const VIDEO_QUALITIES: VideoQuality[] = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"]

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  const [maxConcurrent, setMaxConcurrent] = useState("")
  const [defaultQuality, setDefaultQuality] = useState<VideoQuality>("best")
  const [defaultDownloadType, setDefaultDownloadType] = useState<DownloadType>("video")

  useEffect(() => {
    if (!settings) return
    setMaxConcurrent(String(settings.maxConcurrentDownloads))
    setDefaultQuality(settings.defaultQuality as VideoQuality)
    setDefaultDownloadType(settings.defaultDownloadType)
  }, [settings])

  const handleSave = () => {
    if (!settings) return
    const payload: UpdateSettingsRequest = {}

    const n = Number(maxConcurrent)
    if (n > 0 && n !== settings.maxConcurrentDownloads) payload.maxConcurrentDownloads = n
    if (defaultQuality !== settings.defaultQuality) payload.defaultQuality = defaultQuality
    if (defaultDownloadType !== settings.defaultDownloadType) payload.defaultDownloadType = defaultDownloadType

    if (Object.keys(payload).length === 0) return
    updateSettings.mutate(payload)
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading || !settings ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="download-directory">Download Directory</Label>
                <Input id="download-directory" value={settings.downloadDirectory} disabled />
                <p className="text-xs text-muted-foreground">
                  Set via the <code>MEDIA_ROOT</code> environment variable — not editable here.
                </p>
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

              <Button onClick={handleSave} disabled={updateSettings.isPending}>
                {updateSettings.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <AccountCard />
      <DownloadsCard />
      <PrivacyCard />
      <ThumbnailsCard />
      <JellyfinCard />
      <AppearanceCard />
    </div>
  )
}

function JellyfinCard() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const rescan = useRescanJellyfinLibrary()

  const [enabled, setEnabled] = useState(false)
  const [url, setUrl] = useState("")
  const [apiKey, setApiKey] = useState("")

  useEffect(() => {
    if (!settings) return
    setEnabled(settings.jellyfinEnabled)
    setUrl(settings.jellyfinUrl)
    setApiKey(settings.jellyfinApiKey)
  }, [settings])

  const handleSave = () => {
    if (!settings) return
    const payload: UpdateSettingsRequest = {}

    if (enabled !== settings.jellyfinEnabled) payload.jellyfinEnabled = enabled
    if (url !== settings.jellyfinUrl) payload.jellyfinUrl = url
    if (apiKey !== settings.jellyfinApiKey) payload.jellyfinApiKey = apiKey

    if (Object.keys(payload).length === 0) return
    updateSettings.mutate(payload)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jellyfin</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !settings ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="flex items-start gap-2">
              <Checkbox id="jellyfin-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
              <div className="space-y-1">
                <Label htmlFor="jellyfin-enabled" className="font-normal">
                  Enable Jellyfin
                </Label>
                <p className="text-xs text-muted-foreground">
                  Lets you manually trigger a library rescan below — nothing happens automatically.
                </p>
              </div>
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

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={updateSettings.isPending}>
                {updateSettings.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="outline"
                onClick={() => rescan.mutate()}
                disabled={!enabled || !url || !apiKey || rescan.isPending}
              >
                {rescan.isPending ? "Rescanning…" : "Rescan Library Now"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function AccountCard() {
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
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
      </CardContent>
    </Card>
  )
}

function DownloadsCard() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Downloads</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !settings ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div className="flex items-start gap-2">
            <Checkbox
              id="skip-download-preview"
              checked={settings.skipDownloadPreview}
              disabled={updateSettings.isPending}
              onCheckedChange={(v) => updateSettings.mutate({ skipDownloadPreview: v === true })}
            />
            <div className="space-y-1">
              <Label htmlFor="skip-download-preview" className="font-normal">
                I trust this source (skip preview)
              </Label>
              <p className="text-xs text-muted-foreground">
                Skips the thumbnail/title preview in the New Download dialog and queues
                immediately. Shown by default so you can catch a bad URL before it fails in
                the queue.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const FRAME_COUNT_OPTIONS = [2, 4, 6, 8]

function ThumbnailsCard() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thumbnails</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !settings ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div className="space-y-2">
            <Label>"Choose from Video" frame count</Label>
            <Select
              value={String(settings.thumbnailFrameCount)}
              onValueChange={(v) => updateSettings.mutate({ thumbnailFrameCount: Number(v) })}
            >
              <SelectTrigger className="w-32">
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
            <p className="text-xs text-muted-foreground">
              How many frame options to offer when picking a thumbnail from a video.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const BLUR_STRENGTH_OPTIONS: { value: string; label: string }[] = [
  { value: "weak", label: "Weak" },
  { value: "default", label: "Default" },
  { value: "strong", label: "Strong" },
]

function PrivacyCard() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !settings ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="flex items-start gap-2">
              <Checkbox
                id="history-anonymize"
                checked={settings.historyAnonymizeUrls}
                disabled={updateSettings.isPending}
                onCheckedChange={(v) => updateSettings.mutate({ historyAnonymizeUrls: v === true })}
              />
              <div className="space-y-1">
                <Label htmlFor="history-anonymize" className="font-normal">
                  Anonymize History Links
                </Label>
                <p className="text-xs text-muted-foreground">
                  Replaces links on the History page with a hash — the actual file/download is
                  unaffected, and Retry still works.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Private Collection Blur Strength</Label>
              <Select
                value={settings.privacyBlurStrength}
                onValueChange={(v) => updateSettings.mutate({ privacyBlurStrength: v })}
              >
                <SelectTrigger className="w-40">
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
              <p className="text-xs text-muted-foreground">
                How strongly thumbnails in private collections are blurred until clicked to reveal.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
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
      </CardContent>
    </Card>
  )
}
