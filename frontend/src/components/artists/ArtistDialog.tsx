import { useRef, useState, type ReactNode } from "react"
import { ImageIcon, Plus, X } from "lucide-react"
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
import { Separator } from "@/components/ui/separator"
import {
  useAddArtistImage,
  useArtistImageCandidates,
  useArtistImages,
  useClearArtistSelectedImage,
  useCreateArtist,
  useDeleteArtistImage,
  useSelectArtistImage,
  useUpdateArtist,
} from "@/hooks/useArtists"
import { imageUrl, mediaFileUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Artist } from "@/types/api"

interface ArtistDialogProps {
  artist?: Artist
  trigger?: ReactNode
}

export function ArtistDialog({ artist, trigger }: ArtistDialogProps) {
  const isEdit = artist != null
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(artist?.name ?? "")
  const [showCandidates, setShowCandidates] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const createArtist = useCreateArtist()
  const updateArtist = useUpdateArtist()
  const pending = createArtist.isPending || updateArtist.isPending

  const artistId = artist?.id ?? 0
  const { data: images } = useArtistImages(artistId, isEdit && open)
  const { data: candidatesData } = useArtistImageCandidates(artistId, isEdit && open && showCandidates)
  const addImage = useAddArtistImage(artistId)
  const deleteImage = useDeleteArtistImage(artistId)
  const selectImage = useSelectArtistImage(artistId)
  const clearSelectedImage = useClearArtistSelectedImage(artistId)

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName(artist?.name ?? "")
      setShowCandidates(false)
    }
    setOpen(next)
  }

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) return

    if (isEdit) {
      updateArtist.mutate({ id: artist.id, payload: { name: trimmed } }, { onSuccess: () => setOpen(false) })
    } else {
      createArtist.mutate({ name: trimmed }, { onSuccess: () => setOpen(false) })
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1)
      addImage.mutate({ imageBase64: base64, filename: file.name })
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4" />
            New Artist
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className={cn("flex max-h-[94vh] flex-col overflow-hidden", isEdit ? "sm:max-w-xl" : "sm:max-w-sm")}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Artist" : "New Artist"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Changes here update this artist everywhere it's used."
              : "Create an artist to make it available in the Artist picker on library items and downloads."}
          </DialogDescription>
        </DialogHeader>

        {/* Only this area scrolls as a last resort — the header and footer
            stay pinned, and the two image grids below already cap their own
            height and scroll independently, so this wrapper rarely needs to
            scroll itself. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        <div className="flex items-start gap-4">
          {isEdit && (
            <div className="group relative h-48 w-48 shrink-0 overflow-hidden rounded-md border bg-muted">
              {artist.selectedImagePath ? (
                <img src={imageUrl(artist.selectedImagePath)} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImageIcon className="h-16 w-16 text-muted-foreground/40" />
                </div>
              )}
              {artist.selectedImagePath && (
                <button
                  type="button"
                  onClick={() => clearSelectedImage.mutate()}
                  disabled={clearSelectedImage.isPending}
                  className="absolute top-1.5 right-1.5 rounded-full bg-black/70 p-1 text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-50"
                  title="Remove selected image"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          <div className="flex-1 space-y-2">
            <Label htmlFor="artist-name">Name</Label>
            <Input
              id="artist-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
        </div>

        {isEdit && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium whitespace-nowrap">Artist Images</span>
              <Separator className="flex-1" />
            </div>
            {images && images.length > 0 && (
              <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
                {images.map((img) => {
                  const selected = artist.selectedImagePath === img.relativePath
                  return (
                    <div key={img.id} className="group relative aspect-square overflow-hidden rounded-md border">
                      <button
                        type="button"
                        onClick={() => selectImage.mutate(img.id)}
                        className="h-full w-full outline-hidden transition hover:opacity-80"
                        title={selected ? "Currently selected" : "Use as display image"}
                      >
                        <img src={imageUrl(img.relativePath)} alt="" className="h-full w-full object-cover" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteImage.mutate(img.id)}
                        className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                        title="Delete image"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowCandidates((v) => !v)}
              >
                Add from downloaded files
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                Upload image
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {showCandidates && (
              <div className="rounded-md border p-2">
                {candidatesData == null ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : candidatesData.candidates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No thumbnails found among this artist's downloaded files.</p>
                ) : (
                  <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
                    {candidatesData.candidates.map((c) => (
                      <button
                        key={c.relPath}
                        type="button"
                        disabled={addImage.isPending}
                        onClick={() => addImage.mutate({ sourceRelPath: c.relPath })}
                        className="aspect-square overflow-hidden rounded-md border transition hover:ring-2 hover:ring-primary disabled:opacity-50"
                      >
                        <img src={mediaFileUrl(c.relPath)} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!name.trim() || pending}>
            {pending ? "Saving…" : isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
