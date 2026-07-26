import { useRef, useState, type ReactNode } from "react"
import { format, parseISO } from "date-fns"
import { CalendarIcon, ImageIcon, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
import { calculateAge, cn } from "@/lib/utils"
import type { Artist } from "@/types/api"

interface ArtistDialogProps {
  artist?: Artist
  trigger?: ReactNode
}

export function ArtistDialog({ artist, trigger }: ArtistDialogProps) {
  const isEdit = artist != null
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(artist?.name ?? "")
  const [birthday, setBirthday] = useState(artist?.birthday ?? "")
  const [birthdayOpen, setBirthdayOpen] = useState(false)
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
      setBirthday(artist?.birthday ?? "")
      setShowCandidates(false)
    }
    setOpen(next)
  }

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const payload = { name: trimmed, birthday: birthday || null }

    if (isEdit) {
      updateArtist.mutate({ id: artist.id, payload }, { onSuccess: () => setOpen(false) })
    } else {
      createArtist.mutate(payload, { onSuccess: () => setOpen(false) })
    }
  }

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        resolve(dataUrl.slice(dataUrl.indexOf(",") + 1))
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })

  // Uploaded one at a time (not Promise.all) so a multi-file select doesn't
  // fire a burst of concurrent ffmpeg processes on the backend — addImage's
  // own onError already toasts per-file failures, so one bad file doesn't
  // stop the rest of the batch.
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ""
    for (const file of files) {
      try {
        const base64 = await readFileAsBase64(file)
        await addImage.mutateAsync({ imageBase64: base64, filename: file.name })
      } catch {
        // already toasted by the mutation's onError
      }
    }
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => clearSelectedImage.mutate()}
                      disabled={clearSelectedImage.isPending}
                      className="absolute top-1.5 right-1.5 rounded-full bg-black/70 p-1 text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Remove selected image</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          <div className="flex-1 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="artist-name">Name</Label>
              <Input
                id="artist-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="artist-birthday">Birthday</Label>
              <Popover open={birthdayOpen} onOpenChange={setBirthdayOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="artist-birthday"
                    type="button"
                    variant="outline"
                    className={cn("w-full justify-start font-normal", !birthday && "text-muted-foreground")}
                  >
                    <CalendarIcon className="h-4 w-4" />
                    {birthday ? format(parseISO(birthday), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    captionLayout="dropdown"
                    startMonth={new Date(1900, 0)}
                    endMonth={new Date()}
                    disabled={{ after: new Date() }}
                    defaultMonth={birthday ? parseISO(birthday) : undefined}
                    selected={birthday ? parseISO(birthday) : undefined}
                    onSelect={(date) => {
                      setBirthday(date ? format(date, "yyyy-MM-dd") : "")
                      setBirthdayOpen(false)
                    }}
                  />
                </PopoverContent>
              </Popover>
              {birthday && <p className="text-sm text-muted-foreground">Age: {calculateAge(birthday)}</p>}
            </div>
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
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => selectImage.mutate(img.id)}
                            className="h-full w-full outline-hidden transition hover:opacity-80"
                          >
                            <img src={imageUrl(img.relativePath)} alt="" className="h-full w-full object-cover" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{selected ? "Currently selected" : "Use as display image"}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => deleteImage.mutate(img.id)}
                            className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Delete image</TooltipContent>
                      </Tooltip>
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
                Upload images
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
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
