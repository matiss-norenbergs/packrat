import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useUpdateLibraryItem } from "@/hooks/useLibrary"
import { formatDuration } from "@/lib/utils"
import type { LibraryItem, UpdateLibraryItemRequest } from "@/types/api"

function baseNameWithoutExt(filename: string): string {
  const idx = filename.lastIndexOf(".")
  return idx > 0 ? filename.slice(0, idx) : filename
}

interface EditLibraryItemDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditLibraryItemDialog({ item, open, onOpenChange }: EditLibraryItemDialogProps) {
  const [title, setTitle] = useState(item.title)
  const [filename, setFilename] = useState(baseNameWithoutExt(item.filename))
  const [uploader, setUploader] = useState(item.uploader ?? "")
  const [duration, setDuration] = useState(item.duration != null ? String(item.duration) : "")
  const [resolution, setResolution] = useState(item.resolution ?? "")
  const [description, setDescription] = useState(item.description ?? "")
  const [originalUrl, setOriginalUrl] = useState(item.originalUrl ?? "")

  const updateLibraryItem = useUpdateLibraryItem()

  const resetFields = () => {
    setTitle(item.title)
    setFilename(baseNameWithoutExt(item.filename))
    setUploader(item.uploader ?? "")
    setDuration(item.duration != null ? String(item.duration) : "")
    setResolution(item.resolution ?? "")
    setDescription(item.description ?? "")
    setOriginalUrl(item.originalUrl ?? "")
  }

  const handleOpenChange = (next: boolean) => {
    if (next) resetFields()
    onOpenChange(next)
  }

  const handleSubmit = () => {
    const payload: UpdateLibraryItemRequest = {}

    const trimmedTitle = title.trim()
    if (trimmedTitle && trimmedTitle !== item.title) payload.title = trimmedTitle

    const trimmedFilename = filename.trim()
    if (trimmedFilename && trimmedFilename !== baseNameWithoutExt(item.filename)) payload.filename = trimmedFilename

    const trimmedUploader = uploader.trim()
    if (trimmedUploader !== (item.uploader ?? "")) payload.uploader = trimmedUploader

    const trimmedResolution = resolution.trim()
    if (trimmedResolution !== (item.resolution ?? "")) payload.resolution = trimmedResolution

    const trimmedDescription = description.trim()
    if (trimmedDescription !== (item.description ?? "")) payload.description = trimmedDescription

    const trimmedOriginalUrl = originalUrl.trim()
    if (trimmedOriginalUrl !== (item.originalUrl ?? "")) payload.originalUrl = trimmedOriginalUrl

    const parsedDuration = duration.trim() === "" ? null : Number(duration)
    if (parsedDuration !== item.duration && parsedDuration != null && !Number.isNaN(parsedDuration)) {
      payload.duration = parsedDuration
    }

    if (Object.keys(payload).length === 0) {
      onOpenChange(false)
      return
    }
    updateLibraryItem.mutate({ id: item.id, payload }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit</DialogTitle>
          <DialogDescription>
            Changing the filename also renames the actual media file and thumbnail on disk (the
            extension is kept). Everything else is display-only metadata.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-filename">Filename (without extension)</Label>
            <Input id="edit-filename" value={filename} onChange={(e) => setFilename(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-uploader">Uploader</Label>
              <Input id="edit-uploader" value={uploader} onChange={(e) => setUploader(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-resolution">Resolution</Label>
              <Input
                id="edit-resolution"
                placeholder="1920x1080"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-duration">Duration (seconds)</Label>
            <Input
              id="edit-duration"
              type="number"
              min="0"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
            {duration.trim() !== "" && !Number.isNaN(Number(duration)) && (
              <p className="text-xs text-muted-foreground">{formatDuration(Number(duration))}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              rows={5}
              className="max-h-48 overflow-y-auto"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-original-url">Original URL</Label>
            <Input
              id="edit-original-url"
              placeholder="https://... (unset for files imported without a known source)"
              value={originalUrl}
              onChange={(e) => setOriginalUrl(e.target.value)}
            />
            {!item.originalUrl && (
              <p className="text-xs text-muted-foreground">
                Setting a URL unlocks Refresh Metadata and Redownload for this item.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Downloaded {new Date(item.downloadedAt).toLocaleString()}
          </p>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={updateLibraryItem.isPending}>
            {updateLibraryItem.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
