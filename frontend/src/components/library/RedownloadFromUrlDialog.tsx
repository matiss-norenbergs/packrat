import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { ResolutionValue } from "@/components/ResolutionValue"
import { useRedownloadLibraryItemFromUrl, useRedownloadPreview } from "@/hooks/useLibrary"
import { libraryMediumThumbnailUrl } from "@/lib/api"
import { cn, formatDuration } from "@/lib/utils"
import type { LibraryItem, RedownloadOverwriteField } from "@/types/api"

interface RedownloadFromUrlDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Field {
  key: RedownloadOverwriteField
  label: string
  source: string
  saved: string
  resolution?: boolean
}

// Resolution/Duration can legitimately change on any redownload and are
// checked by default; the rest default unchecked — the new link is usually
// just a replacement source for the same content, not a reason to also
// rename/re-describe the item.
const DEFAULT_CHECKED: RedownloadOverwriteField[] = ["resolution", "duration"]

export function RedownloadFromUrlDialog({ item, open, onOpenChange }: RedownloadFromUrlDialogProps) {
  const [url, setUrl] = useState("")
  const [revealed, setRevealed] = useState(false)
  const [checked, setChecked] = useState<Set<RedownloadOverwriteField>>(new Set(DEFAULT_CHECKED))
  const fetchPreview = useRedownloadPreview()
  const redownload = useRedownloadLibraryItemFromUrl()

  const reset = () => {
    setUrl("")
    setChecked(new Set(DEFAULT_CHECKED))
    fetchPreview.reset()
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleFetch = () => {
    if (!url.trim()) return
    fetchPreview.mutate({ id: item.id, url: url.trim() })
  }

  const handleRedownload = () => {
    redownload.mutate(
      { id: item.id, url: url.trim(), overwriteFields: Array.from(checked) },
      { onSuccess: () => handleOpenChange(false) },
    )
  }

  const toggleField = (key: RedownloadOverwriteField) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const preview = fetchPreview.data
  const savedDuration = item.duration != null ? formatDuration(item.duration) : "—"
  const fields: Field[] = preview
    ? [
        { key: "title", label: "Title", source: preview.title, saved: item.title },
        { key: "uploader", label: "Uploader", source: preview.uploader || "—", saved: item.uploader || "—" },
        { key: "duration", label: "Duration", source: preview.duration ? formatDuration(preview.duration) : "—", saved: savedDuration },
        { key: "resolution", label: "Resolution", source: preview.resolution ?? "—", saved: item.resolution ?? "—", resolution: true },
        { key: "description", label: "Description", source: preview.description || "—", saved: item.description || "—" },
      ]
    : []

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Redownload from different URL</DialogTitle>
          <DialogDescription>
            Fetch the file from a different link, replacing the current one. The new URL always replaces the saved
            source URL — pick which other fields to overwrite below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleFetch()
            }}
          />
          <Button type="button" variant="outline" onClick={handleFetch} disabled={!url.trim() || fetchPreview.isPending}>
            {fetchPreview.isPending ? "Fetching…" : "Fetch"}
          </Button>
        </div>

        {fetchPreview.isError && (
          <p className="text-sm text-destructive">
            Couldn't fetch that URL: {fetchPreview.error instanceof Error ? fetchPreview.error.message : "unknown error"}
          </p>
        )}

        {preview?.duplicate && (
          <div className="rounded-md border border-amber-600/50 bg-amber-500/10 p-3 text-sm break-words">
            This URL is already in your library as{" "}
            <span className="font-medium">{preview.duplicate.title}</span>.
          </div>
        )}

        {fetchPreview.isPending ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-0 sm:divide-x">
            <div className="space-y-3 sm:pr-6">
              <Skeleton className="aspect-video w-full rounded-md" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="space-y-3 sm:pl-6" />
          </div>
        ) : preview ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-0 sm:divide-x">
            <div className="space-y-3 sm:pr-6">
              <h3 className="text-sm font-medium text-muted-foreground">From New URL</h3>
              <div className="aspect-video w-full overflow-hidden rounded-md bg-muted">
                <BlurredThumbnail
                  src={preview.thumbnail}
                  className="h-full w-full object-cover"
                  blurred={item.blurred}
                  revealed={revealed}
                  onToggleReveal={() => setRevealed((r) => !r)}
                />
              </div>
              {fields.map((f) => (
                <FieldRow
                  key={f.key}
                  label={f.label}
                  value={f.source}
                  resolution={f.resolution}
                  checkbox={
                    <Checkbox
                      id={`overwrite-${f.key}`}
                      checked={checked.has(f.key)}
                      onCheckedChange={() => toggleField(f.key)}
                    />
                  }
                />
              ))}
              <FieldRow
                label="Thumbnail"
                value=""
                checkbox={
                  <Checkbox
                    id="overwrite-thumbnail"
                    checked={checked.has("thumbnail")}
                    onCheckedChange={() => toggleField("thumbnail")}
                  />
                }
              />
            </div>

            <div className="space-y-3 sm:pl-6">
              <h3 className="text-sm font-medium text-muted-foreground">Currently Saved</h3>
              <div className="aspect-video w-full overflow-hidden rounded-md bg-muted">
                {item.thumbnail ? (
                  <BlurredThumbnail
                    src={libraryMediumThumbnailUrl(item)!}
                    className="h-full w-full object-cover"
                    blurred={item.blurred}
                    revealed={revealed}
                    onToggleReveal={() => setRevealed((r) => !r)}
                  />
                ) : null}
              </div>
              {fields.map((f) => (
                <FieldRow key={f.key} label={f.label} value={f.saved} resolution={f.resolution} />
              ))}
              <FieldRow label="Thumbnail" value="" />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleRedownload} disabled={!preview || redownload.isPending}>
            {redownload.isPending ? "Queuing…" : "Redownload from this URL"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FieldRow({
  label,
  value,
  resolution,
  checkbox,
}: {
  label: string
  value: string
  resolution?: boolean
  checkbox?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-xs text-muted-foreground">{label}</div>
        {resolution ? (
          <ResolutionValue resolution={value === "—" ? null : value} className="text-sm whitespace-pre-wrap" />
        ) : (
          <p className={cn("text-sm whitespace-pre-wrap", !value && "text-muted-foreground")}>{value}</p>
        )}
      </div>
      {checkbox && (
        <div className="flex shrink-0 items-center gap-1.5 pt-4">
          {checkbox}
          <Label className="text-xs font-normal text-muted-foreground">Overwrite</Label>
        </div>
      )}
    </div>
  )
}
