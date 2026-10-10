import { useRef } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useCollectionCoverCandidates, useSetCollectionCover } from "@/hooks/useCollections"
import { ResizedImage } from "@/components/ResizedImage"
import type { ResizeWidth } from "@/lib/api"

// Candidate widths for a picker tile's srcset; sizes mirrors the dialog layout:
// p-4 padding, gap-3, 95vw wide from sm (640px) up with 6 columns, otherwise
// the default viewport-minus-2rem width with 4 columns.
const TILE_WIDTHS: readonly ResizeWidth[] = [320, 480, 720]
const TILE_SIZES = "(min-width: 640px) calc((95vw - 92px) / 6), calc((100vw - 100px) / 4)"

interface CollectionCoverDialogProps {
  collectionId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CollectionCoverDialog({ collectionId, open, onOpenChange }: CollectionCoverDialogProps) {
  const { data, isLoading } = useCollectionCoverCandidates(collectionId, open)
  const setCover = useSetCollectionCover(collectionId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handlePickCandidate = (relPath: string) => {
    setCover.mutate({ sourceRelPath: relPath }, { onSuccess: () => onOpenChange(false) })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1)
      setCover.mutate({ imageBase64: base64, filename: file.name }, { onSuccess: () => onOpenChange(false) })
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>Pick cover art</DialogTitle>
          <DialogDescription>Choose an image already among this collection's files, or upload a new one.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">From this collection's files</p>
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={setCover.isPending}>
            Upload image instead
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>

        {/* Only this candidates area scrolls — the header and upload row
            above stay pinned in view no matter how many images this
            collection's folder turns up. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : data == null || data.candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No image files found under this collection's folder.</p>
          ) : (
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
              {data.candidates.map((c) => (
                <button
                  key={c.relPath}
                  type="button"
                  disabled={setCover.isPending}
                  onClick={() => handlePickCandidate(c.relPath)}
                  className="aspect-square overflow-hidden rounded-md border transition hover:ring-2 hover:ring-primary disabled:opacity-50"
                >
                  <ResizedImage
                    root="media"
                    path={c.relPath}
                    widths={TILE_WIDTHS}
                    sizes={TILE_SIZES}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
