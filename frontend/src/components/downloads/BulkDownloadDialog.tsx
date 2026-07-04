import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ListPlus, Plus, X } from "lucide-react"
import { toast } from "sonner"
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
import { Textarea } from "@/components/ui/textarea"
import { createDownload } from "@/lib/api"
import { downloadsQueryKey } from "@/hooks/useDownloads"
import { useCollections } from "@/hooks/useCollections"
import type { AudioFormat, DownloadType, VideoQuality } from "@/types/api"

const VIDEO_QUALITIES: VideoQuality[] = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"]
const AUDIO_FORMATS: AudioFormat[] = ["mp3", "flac", "m4a", "aac", "wav"]
const NO_COLLECTION = "none"
const MAX_ROWS = 50

interface BulkRow {
  key: string
  url: string
  collectionId: string
  downloadType: DownloadType
  quality: VideoQuality
  audioFormat: AudioFormat
  filename: string
}

let rowCounter = 0
function newRow(base?: Partial<BulkRow>): BulkRow {
  rowCounter += 1
  return {
    key: `row-${rowCounter}`,
    url: "",
    collectionId: NO_COLLECTION,
    downloadType: "video",
    quality: "best",
    audioFormat: "mp3",
    filename: "",
    ...base,
  }
}

function blankRows(count: number): BulkRow[] {
  return Array.from({ length: count }, () => newRow())
}

export function BulkDownloadDialog() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<BulkRow[]>(() => blankRows(3))
  const [pasteText, setPasteText] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const { data: collections } = useCollections()
  const queryClient = useQueryClient()

  const reset = () => {
    setRows(blankRows(3))
    setPasteText("")
  }

  const handleOpenChange = (next: boolean) => {
    if (next) reset()
    setOpen(next)
  }

  const atCap = rows.length >= MAX_ROWS

  const updateRow = (key: string, patch: Partial<BulkRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const removeRow = (key: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev))
  }

  const addRow = () => {
    if (atCap) return
    setRows((prev) => [...prev, newRow(prev[prev.length - 1])])
  }

  const handlePasteApply = () => {
    const urls = pasteText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    if (urls.length === 0) return

    setRows((prev) => {
      const lastSettings = prev[prev.length - 1]
      const room = MAX_ROWS - prev.length
      const toAdd = urls.slice(0, Math.max(room, 0))
      const appended = toAdd.map((url) => newRow({ ...lastSettings, url }))
      return [...prev, ...appended]
    })
    setPasteText("")
  }

  const handleSubmit = async () => {
    const toSubmit = rows.filter((r) => r.url.trim())
    if (toSubmit.length === 0) return

    setSubmitting(true)
    const results = await Promise.allSettled(
      toSubmit.map((r) =>
        createDownload({
          url: r.url.trim(),
          collectionId: r.collectionId === NO_COLLECTION ? undefined : Number(r.collectionId),
          downloadType: r.downloadType,
          quality: r.downloadType === "video" ? r.quality : undefined,
          audioFormat: r.downloadType === "audio" ? r.audioFormat : undefined,
          filename: r.filename.trim() || undefined,
        }),
      ),
    )
    setSubmitting(false)

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.length - succeeded

    queryClient.invalidateQueries({ queryKey: downloadsQueryKey })

    if (failed === 0) {
      toast.success(`${succeeded} download${succeeded === 1 ? "" : "s"} queued`)
      setOpen(false)
      reset()
    } else {
      const failedUrls = toSubmit
        .filter((_, i) => results[i].status === "rejected")
        .map((r) => r.url)
        .slice(0, 3)
        .join(", ")
      toast.error(
        `${succeeded} queued, ${failed} failed${failedUrls ? `: ${failedUrls}${failed > 3 ? "…" : ""}` : ""}`,
      )
    }
  }

  const anyUrl = rows.some((r) => r.url.trim())

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ListPlus className="h-4 w-4" />
          Bulk Download
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk Download</DialogTitle>
          <DialogDescription>
            Queue multiple URLs at once. Each row can have its own collection, type, and quality.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bulk-paste">Paste URLs (one per line)</Label>
            <div className="flex gap-2">
              <Textarea
                id="bulk-paste"
                rows={2}
                placeholder="https://...&#10;https://..."
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <Button variant="secondary" onClick={handlePasteApply} disabled={!pasteText.trim() || atCap}>
                Add
              </Button>
            </div>
          </div>

          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {rows.map((row) => (
              <div key={row.key} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                <div className="min-w-[220px] flex-1 space-y-1">
                  <Label htmlFor={`bulk-url-${row.key}`}>URL</Label>
                  <Input
                    id={`bulk-url-${row.key}`}
                    placeholder="https://..."
                    value={row.url}
                    onChange={(e) => updateRow(row.key, { url: e.target.value })}
                  />
                </div>

                <div className="w-40 space-y-1">
                  <Label>Collection</Label>
                  <Select
                    value={row.collectionId}
                    onValueChange={(v) => updateRow(row.key, { collectionId: v })}
                  >
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

                <div className="w-28 space-y-1">
                  <Label>Type</Label>
                  <Select
                    value={row.downloadType}
                    onValueChange={(v) => updateRow(row.key, { downloadType: v as DownloadType })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="video">Video</SelectItem>
                      <SelectItem value="audio">Audio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {row.downloadType === "video" ? (
                  <div className="w-28 space-y-1">
                    <Label>Quality</Label>
                    <Select
                      value={row.quality}
                      onValueChange={(v) => updateRow(row.key, { quality: v as VideoQuality })}
                    >
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
                  <div className="w-28 space-y-1">
                    <Label>Format</Label>
                    <Select
                      value={row.audioFormat}
                      onValueChange={(v) => updateRow(row.key, { audioFormat: v as AudioFormat })}
                    >
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

                <div className="w-36 space-y-1">
                  <Label>Filename</Label>
                  <Input
                    placeholder="optional"
                    value={row.filename}
                    onChange={(e) => updateRow(row.key, { filename: e.target.value })}
                  />
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  title="Remove row"
                  disabled={rows.length <= 1}
                  onClick={() => removeRow(row.key)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={addRow} disabled={atCap}>
              <Plus className="h-4 w-4" />
              Add row
            </Button>
            {atCap && <p className="text-xs text-muted-foreground">Limit of {MAX_ROWS} rows reached</p>}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!anyUrl || submitting}>
            {submitting ? "Queuing…" : "Download All"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
