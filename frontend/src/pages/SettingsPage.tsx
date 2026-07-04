import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Default Type</Label>
                  <Select value={defaultDownloadType} onValueChange={(v) => setDefaultDownloadType(v as DownloadType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="video">Video</SelectItem>
                      <SelectItem value="audio">Audio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Default Quality</Label>
                  <Select value={defaultQuality} onValueChange={(v) => setDefaultQuality(v as VideoQuality)}>
                    <SelectTrigger>
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

      <AppearanceCard />
    </div>
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
