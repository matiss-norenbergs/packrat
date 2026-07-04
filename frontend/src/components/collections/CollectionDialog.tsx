import { useState, type ReactNode } from "react"
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
import { useCreateCollection, useUpdateCollection } from "@/hooks/useCollections"
import type { Collection, DownloadType, VideoQuality } from "@/types/api"

const VIDEO_QUALITIES: VideoQuality[] = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"]

interface CollectionDialogProps {
  collection?: Collection
  /** Parent to create the new collection under. Ignored in edit mode — a
   * collection's parent is fixed at creation time and cannot be changed. */
  parentId?: number
  trigger?: ReactNode
}

export function CollectionDialog({ collection, parentId, trigger }: CollectionDialogProps) {
  const isEdit = collection != null
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(collection?.name ?? "")
  const [rootPath, setRootPath] = useState(collection?.rootPath ?? "")
  const [defaultQuality, setDefaultQuality] = useState<VideoQuality>((collection?.defaultQuality as VideoQuality) ?? "best")
  const [defaultDownloadType, setDefaultDownloadType] = useState<DownloadType>(collection?.defaultDownloadType ?? "video")

  const createCollection = useCreateCollection()
  const updateCollection = useUpdateCollection()
  const pending = createCollection.isPending || updateCollection.isPending

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // Reset fields from the current collection (or blank, for create) each
      // time the dialog opens, so stale edits from a previous open don't linger.
      setName(collection?.name ?? "")
      setRootPath(collection?.rootPath ?? "")
      setDefaultQuality((collection?.defaultQuality as VideoQuality) ?? "best")
      setDefaultDownloadType(collection?.defaultDownloadType ?? "video")
    }
    setOpen(next)
  }

  const handleSubmit = () => {
    if (!name.trim() || !rootPath.trim()) return
    const payload = {
      name: name.trim(),
      rootPath: rootPath.trim(),
      defaultQuality,
      defaultDownloadType,
      ...(isEdit ? {} : { parentId }),
    }

    if (isEdit) {
      updateCollection.mutate(
        { id: collection.id, payload },
        { onSuccess: () => setOpen(false) },
      )
    } else {
      createCollection.mutate(payload, { onSuccess: () => setOpen(false) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4" />
            New Collection
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Collection" : "New Collection"}</DialogTitle>
          <DialogDescription>
            Collections are named presets — a folder under your media root plus default quality
            and type, selectable from the New Download dialog.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isEdit && (
            <p className="text-sm text-muted-foreground">
              Location: <span className="font-mono">{collection.path}</span> (a collection's
              position in the tree can't be changed after creation)
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="collection-name">Name</Label>
            <Input id="collection-name" placeholder="Music" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div className="space-y-2">
            <Label htmlFor="collection-root">Folder name (inside your media root)</Label>
            <Input
              id="collection-root"
              placeholder="Music"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Default Type</Label>
              <Select value={defaultDownloadType} onValueChange={(v) => setDefaultDownloadType(v as DownloadType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="audio">Audio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default Quality</Label>
              <Select value={defaultQuality} onValueChange={(v) => setDefaultQuality(v as VideoQuality)}>
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
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!name.trim() || !rootPath.trim() || pending}>
            {pending ? "Saving…" : isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
