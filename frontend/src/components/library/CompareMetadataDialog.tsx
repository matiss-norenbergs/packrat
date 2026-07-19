import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { useLibraryItemMetadataPreview } from "@/hooks/useLibrary"
import { mediaFileUrl } from "@/lib/api"
import { cn, formatDuration } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"

interface CompareMetadataDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Field {
  label: string
  source: string | null
  saved: string
}

export function CompareMetadataDialog({ item, open, onOpenChange }: CompareMetadataDialogProps) {
  const { data, isLoading, isError, error } = useLibraryItemMetadataPreview(item.id, open)
  const [revealed, setRevealed] = useState(false)

  const savedDuration = item.duration != null ? formatDuration(item.duration) : "—"
  const fields: Field[] = [
    { label: "Title", source: data ? data.title : null, saved: item.title },
    { label: "Uploader", source: data ? data.uploader || "—" : null, saved: item.uploader || "—" },
    {
      label: "Duration",
      source: data ? (data.duration ? formatDuration(data.duration) : "—") : null,
      saved: savedDuration,
    },
    { label: "Resolution", source: data ? (data.resolution ?? "—") : null, saved: item.resolution ?? "—" },
    { label: "Description", source: data ? data.description || "—" : null, saved: item.description || "—" },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compare Metadata</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-0 sm:divide-x">
          <div className="space-y-3 sm:pr-6">
            <h3 className="text-sm font-medium text-muted-foreground">From Source URL</h3>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="aspect-video w-full rounded-md" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ) : isError ? (
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Couldn't fetch metadata from the source URL."}
              </p>
            ) : data ? (
              <>
                <div className="aspect-video w-full overflow-hidden rounded-md bg-muted">
                  <BlurredThumbnail
                    src={data.thumbnail}
                    className="h-full w-full object-cover"
                    blurred={item.blurred}
                    revealed={revealed}
                    onToggleReveal={() => setRevealed((r) => !r)}
                  />
                </div>
                {fields.map((f) => (
                  <FieldRow key={f.label} label={f.label} value={f.source ?? "—"} differs={f.source !== f.saved} />
                ))}
              </>
            ) : null}
          </div>

          <div className="space-y-3 sm:pl-6">
            <h3 className="text-sm font-medium text-muted-foreground">Currently Saved</h3>
            <div className="aspect-video w-full overflow-hidden rounded-md bg-muted">
              {item.thumbnail ? (
                <BlurredThumbnail
                  src={mediaFileUrl(item.thumbnail)}
                  className="h-full w-full object-cover"
                  blurred={item.blurred}
                  revealed={revealed}
                  onToggleReveal={() => setRevealed((r) => !r)}
                />
              ) : null}
            </div>
            {fields.map((f) => (
              <FieldRow key={f.label} label={f.label} value={f.saved} differs={f.source != null && f.source !== f.saved} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FieldRow({ label, value, differs }: { label: string; value: string; differs: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{label}</span>
        {differs && <span className="text-amber-500">differs</span>}
      </div>
      <p className={cn("text-sm whitespace-pre-wrap", differs && "text-amber-500")}>{value}</p>
    </div>
  )
}
