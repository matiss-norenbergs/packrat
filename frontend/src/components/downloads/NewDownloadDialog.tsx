import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import { useCreateDownload, useDownloadPreview } from "@/hooks/useDownloads"
import { useCollections } from "@/hooks/useCollections"
import { useSettings } from "@/hooks/useSettings"
import { formatDuration } from "@/lib/utils"
import type { AudioFormat, DownloadType, VideoQuality } from "@/types/api"

const VIDEO_QUALITIES: VideoQuality[] = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"]
const AUDIO_FORMATS: AudioFormat[] = ["mp3", "flac", "m4a", "aac", "wav"]
const NO_COLLECTION = "none"

export function NewDownloadDialog() {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [collectionId, setCollectionId] = useState(NO_COLLECTION)
  const [downloadType, setDownloadType] = useState<DownloadType>("video")
  const [quality, setQuality] = useState<VideoQuality>("best")
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("mp3")
  const [filename, setFilename] = useState("")
  const [debouncedUrl, setDebouncedUrl] = useState("")

  const { data: collections } = useCollections()
  const { data: settings } = useSettings()
  const createDownload = useCreateDownload()

  const previewEnabled = !settings?.skipDownloadPreview
  const { data: preview, isLoading: previewLoading, isError: previewError } =
    useDownloadPreview(debouncedUrl, previewEnabled)

  useEffect(() => {
    const trimmed = url.trim()
    const looksLikeUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    if (!looksLikeUrl) {
      setDebouncedUrl("")
      return
    }
    const timer = setTimeout(() => setDebouncedUrl(trimmed), 500)
    return () => clearTimeout(timer)
  }, [url])

  const reset = () => {
    setUrl("")
    setDebouncedUrl("")
    setCollectionId(NO_COLLECTION)
    setDownloadType(settings?.defaultDownloadType ?? "video")
    setQuality((settings?.defaultQuality as VideoQuality) ?? "best")
    setAudioFormat("mp3")
    setFilename("")
  }

  const handleOpenChange = (next: boolean) => {
    if (next) reset()
    setOpen(next)
  }

  const handleCollectionChange = (value: string) => {
    setCollectionId(value)
    const collection = collections?.find((c) => String(c.id) === value)
    if (collection) {
      setDownloadType(collection.defaultDownloadType)
      setQuality(collection.defaultQuality as VideoQuality)
    }
  }

  const handleSubmit = () => {
    if (!url.trim()) return
    createDownload.mutate(
      {
        url: url.trim(),
        collectionId: collectionId === NO_COLLECTION ? undefined : Number(collectionId),
        downloadType,
        quality: downloadType === "video" ? quality : undefined,
        audioFormat: downloadType === "audio" ? audioFormat : undefined,
        filename: filename.trim() || undefined,
      },
      {
        onSuccess: () => {
          setOpen(false)
          reset()
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          New Download
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Download</DialogTitle>
          <DialogDescription>Paste any URL supported by yt-dlp.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
          </div>

          {previewEnabled && debouncedUrl && (
            <div className="rounded-md border p-3">
              {previewLoading ? (
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-20 shrink-0 rounded" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ) : previewError ? (
                <p className="text-xs text-muted-foreground">
                  Couldn't fetch a preview for this URL — you can still queue the download.
                </p>
              ) : preview ? (
                <div className="flex items-center gap-3">
                  {preview.thumbnail ? (
                    <img
                      src={preview.thumbnail}
                      alt=""
                      className="h-12 w-20 shrink-0 rounded object-cover bg-muted"
                    />
                  ) : (
                    <div className="h-12 w-20 shrink-0 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium">{preview.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {preview.uploader || "Unknown uploader"}
                      {preview.duration > 0 && ` · ${formatDuration(preview.duration)}`}
                      {preview.resolution && ` · ${preview.resolution}`}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <div className="space-y-2">
            <Label>Collection</Label>
            <Select value={collectionId} onValueChange={handleCollectionChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COLLECTION}>None</SelectItem>
                {collections?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={downloadType} onValueChange={(v) => setDownloadType(v as DownloadType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="audio">Audio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {downloadType === "video" ? (
              <div className="space-y-2">
                <Label>Quality</Label>
                <Select value={quality} onValueChange={(v) => setQuality(v as VideoQuality)}>
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
            ) : (
              <div className="space-y-2">
                <Label>Format</Label>
                <Select value={audioFormat} onValueChange={(v) => setAudioFormat(v as AudioFormat)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIO_FORMATS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="filename">Filename (optional)</Label>
            <Input
              id="filename"
              placeholder="Leave blank to use the video title"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!url.trim() || createDownload.isPending}>
            {createDownload.isPending ? "Queuing…" : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
