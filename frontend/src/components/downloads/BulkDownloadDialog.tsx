import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, ListPlus, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createBatchDownload } from "@/lib/api"
import { downloadsQueryKey } from "@/hooks/useDownloads"
import { historyQueryKey } from "@/hooks/useHistory"
import { NO_ARTIST } from "@/components/library/ArtistSelect"
import { BulkDownloadRow } from "./BulkDownloadRow"
import type { AudioFormat, DownloadType, VideoQuality } from "@/types/api"

const NO_COLLECTION = "none"
const MAX_ROWS = 50

export interface BulkRow {
  key: string
  url: string
  collectionId: string
  downloadType: DownloadType
  quality: VideoQuality
  audioFormat: AudioFormat
  filename: string
  titleOverride: string
  artistId: string
  year: string
  seasonNumber: string
  sequenceNumber: string
  generateNfo: boolean
  tags: string[]
  advancedOpen: boolean
}

// Fields worth carrying over when creating a new row from an existing one —
// deliberately excludes "key" (must always be freshly generated, never
// leaked from a previous row — a duplicate key across two rows breaks
// React's reconciliation, causing edits/removals to land on the wrong row)
// and "url"/"filename"/"titleOverride" (a new row is for a different item,
// so pre-filling any of these would just create an unwanted duplicate).
// sequenceNumber is deliberately NOT here — it's carried separately as
// prev+1 (see nextSequence), not a literal copy, since two rows in the same
// batch almost never share one sequence number.
type RowCarryOver = Pick<
  BulkRow,
  | "collectionId"
  | "downloadType"
  | "quality"
  | "audioFormat"
  | "artistId"
  | "year"
  | "seasonNumber"
  | "generateNfo"
  | "tags"
  | "advancedOpen"
>

let rowCounter = 0
function newRow(carryOver?: Partial<RowCarryOver>, sequenceNumber?: string): BulkRow {
  rowCounter += 1
  return {
    key: `row-${rowCounter}`,
    url: "",
    collectionId: NO_COLLECTION,
    downloadType: "video",
    quality: "best",
    audioFormat: "mp3",
    filename: "",
    titleOverride: "",
    artistId: NO_ARTIST,
    year: "",
    seasonNumber: "",
    sequenceNumber: sequenceNumber ?? "",
    generateNfo: false,
    tags: [],
    advancedOpen: false,
    ...carryOver,
  }
}

// Sequence # auto-increments from the previous row rather than being tied
// to row position (up/down reordering never touches it) — this covers the
// common "next episode" case for free while staying correct when a batch
// mixes unrelated sources, since it's just a starting suggestion the user
// can clear/edit per row like any other carried-over field.
function nextSequence(prev: string): string {
  const n = Number(prev)
  if (prev.trim() === "" || Number.isNaN(n)) return ""
  return String(n + 1)
}

function blankRows(count: number): BulkRow[] {
  return Array.from({ length: count }, () => newRow())
}

function carryOverFrom(row: BulkRow): RowCarryOver {
  return {
    collectionId: row.collectionId,
    downloadType: row.downloadType,
    quality: row.quality,
    audioFormat: row.audioFormat,
    artistId: row.artistId,
    year: row.year,
    seasonNumber: row.seasonNumber,
    generateNfo: row.generateNfo,
    tags: row.tags,
    advancedOpen: row.advancedOpen,
  }
}

export function BulkDownloadDialog() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<BulkRow[]>(() => blankRows(1))
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [skipDuplicates, setSkipDuplicates] = useState(true)

  const queryClient = useQueryClient()

  const reset = () => {
    setRows(blankRows(1))
    setPasteOpen(false)
    setPasteText("")
    setSkipDuplicates(true)
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

  const moveRow = (index: number, direction: -1 | 1) => {
    setRows((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const addRow = () => {
    if (atCap) return
    setRows((prev) => {
      const last = prev[prev.length - 1]
      return [...prev, newRow(carryOverFrom(last), nextSequence(last.sequenceNumber))]
    })
  }

  const handlePasteApply = () => {
    const urls = pasteText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    if (urls.length === 0) return

    setRows((prev) => {
      const last = prev[prev.length - 1]
      const carryOver = carryOverFrom(last)
      const room = MAX_ROWS - prev.length
      const toAdd = urls.slice(0, Math.max(room, 0))
      let seq = last.sequenceNumber
      const appended = toAdd.map((url) => {
        seq = nextSequence(seq)
        return { ...newRow(carryOver, seq), url }
      })
      return [...prev, ...appended]
    })
    setPasteText("")
  }

  const handleSubmit = async () => {
    const toSubmit = rows.filter((r) => r.url.trim())
    if (toSubmit.length === 0) return

    setSubmitting(true)
    let result
    try {
      result = await createBatchDownload({
        items: toSubmit.map((r) => {
          const parsedYear = r.year.trim() === "" ? undefined : Number(r.year)
          const parsedSeason = r.seasonNumber.trim() === "" ? undefined : Number(r.seasonNumber)
          const parsedSequence = r.sequenceNumber.trim() === "" ? undefined : Number(r.sequenceNumber)
          return {
            url: r.url.trim(),
            collectionId: r.collectionId === NO_COLLECTION ? undefined : Number(r.collectionId),
            downloadType: r.downloadType,
            quality: r.downloadType === "video" ? r.quality : undefined,
            audioFormat: r.downloadType === "audio" ? r.audioFormat : undefined,
            filename: r.filename.trim() || undefined,
            title: r.titleOverride.trim() || undefined,
            artistId: r.artistId === NO_ARTIST ? undefined : Number(r.artistId),
            year: parsedYear != null && !Number.isNaN(parsedYear) ? parsedYear : undefined,
            seasonNumber: parsedSeason != null && !Number.isNaN(parsedSeason) ? parsedSeason : undefined,
            sequenceNumber: parsedSequence != null && !Number.isNaN(parsedSequence) ? parsedSequence : undefined,
            generateNfo: r.generateNfo || undefined,
            tags: r.tags.length > 0 ? r.tags : undefined,
          }
        }),
        skipDuplicates,
      })
    } catch (err) {
      setSubmitting(false)
      toast.error(`Failed to queue downloads: ${(err as Error).message}`)
      return
    }
    setSubmitting(false)

    queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    queryClient.invalidateQueries({ queryKey: historyQueryKey })

    const parts = [`${result.queued.length} queued`]
    if (result.skipped.length > 0) parts.push(`${result.skipped.length} already in library`)
    if (result.failed.length > 0) {
      const failedUrls = result.failed.map((f) => f.url).slice(0, 3).join(", ")
      parts.push(`${result.failed.length} failed${failedUrls ? `: ${failedUrls}${result.failed.length > 3 ? "…" : ""}` : ""}`)
    }

    if (result.failed.length === 0) {
      toast.success(parts.join(", "))
      setOpen(false)
      reset()
    } else {
      toast.error(parts.join(", "))
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
      <DialogContent className="sm:max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>Bulk Download</DialogTitle>
          <DialogDescription>
            Queue multiple URLs at once. Each row can have its own collection, type, quality, and metadata.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <button
              type="button"
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setPasteOpen((v) => !v)}
            >
              {pasteOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Paste URLs (one per line)
            </button>
            {pasteOpen && (
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
            )}
          </div>

          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {rows.map((row, index) => (
              <BulkDownloadRow
                key={row.key}
                row={row}
                rowNumber={index + 1}
                isFirst={index === 0}
                isLast={index === rows.length - 1}
                canRemove={rows.length > 1}
                onChange={(patch) => updateRow(row.key, patch)}
                onRemove={() => removeRow(row.key)}
                onMoveUp={() => moveRow(index, -1)}
                onMoveDown={() => moveRow(index, 1)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={addRow} disabled={atCap}>
              <Plus className="h-4 w-4" />
              Add row
            </Button>
            {atCap && <p className="text-xs text-muted-foreground">Limit of {MAX_ROWS} rows reached</p>}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="bulk-skip-dup"
              checked={skipDuplicates}
              onCheckedChange={(v) => setSkipDuplicates(v === true)}
            />
            <Label htmlFor="bulk-skip-dup" className="font-normal">
              Skip items already in the library
            </Label>
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
