import { useState } from "react"
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, X } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { useCollections } from "@/hooks/useCollections"
import { useDownloadPreview } from "@/hooks/useDownloads"
import { useSettings } from "@/hooks/useSettings"
import { ArtistSelect } from "@/components/library/ArtistSelect"
import { formatDuration } from "@/lib/utils"
import type { AudioFormat, DownloadType, VideoQuality } from "@/types/api"
import type { BulkRow } from "./BulkDownloadDialog"

const VIDEO_QUALITIES: VideoQuality[] = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"]
const AUDIO_FORMATS: AudioFormat[] = ["mp3", "flac", "m4a", "aac", "wav"]
const NO_COLLECTION = "none"

interface BulkDownloadRowProps {
  row: BulkRow
  rowNumber: number
  isFirst: boolean
  isLast: boolean
  canRemove: boolean
  onChange: (patch: Partial<BulkRow>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function BulkDownloadRow({
  row,
  rowNumber,
  isFirst,
  isLast,
  canRemove,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: BulkDownloadRowProps) {
  const { data: collections } = useCollections()
  const { data: settings } = useSettings()
  const [previewRequested, setPreviewRequested] = useState(false)

  const previewAllowed = !settings?.skipDownloadPreview
  const { data: preview, isLoading: previewLoading, isError: previewError } = useDownloadPreview(
    row.url.trim(),
    previewRequested && row.url.trim().length > 0,
  )

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 flex-col gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Move up"
            disabled={isFirst}
            onClick={onMoveUp}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Move down"
            disabled={isLast}
            onClick={onMoveDown}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Remove row"
            disabled={!canRemove}
            onClick={onRemove}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">#{rowNumber}</span>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1 space-y-1">
              <Label>URL</Label>
              <div className="flex gap-1">
                <Input
                  placeholder="https://..."
                  value={row.url}
                  onChange={(e) => onChange({ url: e.target.value })}
                />
                {previewAllowed && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Fetch preview"
                    disabled={!row.url.trim()}
                    onClick={() => setPreviewRequested(true)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="w-full shrink-0 space-y-1 sm:w-40">
              <Label>Collection</Label>
              <Select value={row.collectionId} onValueChange={(v) => onChange({ collectionId: v })}>
                <SelectTrigger className="w-full">
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

            <div className="w-full shrink-0 space-y-1 sm:w-24">
              <Label>Type</Label>
              <Select
                value={row.downloadType}
                onValueChange={(v) => onChange({ downloadType: v as DownloadType })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="audio">Audio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {row.downloadType === "video" ? (
              <div className="w-full shrink-0 space-y-1 sm:w-24">
                <Label>Quality</Label>
                <Select value={row.quality} onValueChange={(v) => onChange({ quality: v as VideoQuality })}>
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
            ) : (
              <div className="w-full shrink-0 space-y-1 sm:w-24">
                <Label>Format</Label>
                <Select value={row.audioFormat} onValueChange={(v) => onChange({ audioFormat: v as AudioFormat })}>
                  <SelectTrigger className="w-full">
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

          <div className="space-y-1">
            <Label>Filename</Label>
            <Input
              placeholder="optional"
              value={row.filename}
              onChange={(e) => onChange({ filename: e.target.value })}
            />
          </div>
        </div>
      </div>

      {previewRequested && row.url.trim() && (
        <div className="rounded-md border p-2">
          {previewLoading ? (
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-16 shrink-0 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ) : previewError ? (
            <p className="text-xs text-muted-foreground">Couldn't fetch a preview for this URL.</p>
          ) : preview?.isPlaylist ? (
            <div>
              <p className="line-clamp-1 text-sm font-medium">{preview.playlistTitle || "Playlist"}</p>
              <p className="text-xs text-muted-foreground">
                {preview.playlistCount} videos — playlists aren't expanded here, use New Download for that
              </p>
            </div>
          ) : preview ? (
            <div className="flex items-center gap-3">
              {preview.thumbnail ? (
                <img src={preview.thumbnail} alt="" className="h-10 w-16 shrink-0 rounded object-cover bg-muted" />
              ) : (
                <div className="h-10 w-16 shrink-0 rounded bg-muted" />
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

      <div className="border-t pt-2">
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => onChange({ advancedOpen: !row.advancedOpen })}
        >
          {row.advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Advanced
        </button>

        {row.advancedOpen && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1 lg:col-span-2">
              <Label>Title</Label>
              <Input
                placeholder={preview?.title || "Video title"}
                value={row.titleOverride}
                onChange={(e) => onChange({ titleOverride: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Artist</Label>
              <ArtistSelect value={row.artistId} onValueChange={(v) => onChange({ artistId: v })} />
            </div>
            <div className="space-y-1">
              <Label>Year</Label>
              <Input
                type="number"
                placeholder="2024"
                value={row.year}
                onChange={(e) => onChange({ year: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Season #</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="1"
                  value={row.seasonNumber}
                  onChange={(e) => onChange({ seasonNumber: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Sequence #</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="1"
                  value={row.sequenceNumber}
                  onChange={(e) => onChange({ sequenceNumber: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-5">
              <Checkbox
                id={`bulk-nfo-${row.key}`}
                checked={row.generateNfo}
                onCheckedChange={(v) => onChange({ generateNfo: v === true })}
              />
              <Label htmlFor={`bulk-nfo-${row.key}`} className="font-normal">
                Generate NFO
              </Label>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
