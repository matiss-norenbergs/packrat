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
import { useCreateCollection, useUpdateCollection } from "@/hooks/useCollections"
import { useSettings } from "@/hooks/useSettings"
import { ArtistSelect, NO_ARTIST } from "@/components/library/ArtistSelect"
import { FilenameTemplateBuilderDialog } from "@/components/downloads/FilenameTemplateBuilderDialog"
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
  const [isPrivate, setIsPrivate] = useState(collection?.isPrivate ?? false)
  const [jellyfinLibraryId, setJellyfinLibraryId] = useState(collection?.jellyfinLibraryId ?? "")
  const [seasonNumber, setSeasonNumber] = useState(
    collection?.seasonNumber != null ? String(collection.seasonNumber) : "",
  )
  const [artistId, setArtistId] = useState(collection?.artistId != null ? String(collection.artistId) : NO_ARTIST)
  const [filenameTemplate, setFilenameTemplate] = useState(collection?.filenameTemplate ?? "")

  const { data: settings } = useSettings()
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
      setIsPrivate(collection?.isPrivate ?? false)
      setJellyfinLibraryId(collection?.jellyfinLibraryId ?? "")
      setSeasonNumber(collection?.seasonNumber != null ? String(collection.seasonNumber) : "")
      setArtistId(collection?.artistId != null ? String(collection.artistId) : NO_ARTIST)
      setFilenameTemplate(collection?.filenameTemplate ?? "")
    }
    setOpen(next)
  }

  const handleSubmit = () => {
    if (!name.trim() || !rootPath.trim()) return
    const parsedSeason = seasonNumber.trim() === "" ? null : Number(seasonNumber)
    const payload = {
      name: name.trim(),
      rootPath: rootPath.trim(),
      defaultQuality,
      defaultDownloadType,
      isPrivate,
      jellyfinLibraryId: jellyfinLibraryId.trim() || null,
      seasonNumber: parsedSeason != null && !Number.isNaN(parsedSeason) ? parsedSeason : null,
      artistId: artistId === NO_ARTIST ? null : Number(artistId),
      filenameTemplate: filenameTemplate.trim() || undefined,
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
      <DialogContent className="sm:max-w-lg">
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

          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <Label>Default Type</Label>
              <Select value={defaultDownloadType} onValueChange={(v) => setDefaultDownloadType(v as DownloadType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="audio">Audio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-2">
              <Label>Default Quality</Label>
              <Select value={defaultQuality} onValueChange={(v) => setDefaultQuality(v as VideoQuality)}>
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
          </div>

          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="collection-artist">Artist (optional)</Label>
              <ArtistSelect value={artistId} onValueChange={setArtistId} />
              <p className="text-xs text-muted-foreground">
                New downloads added to this collection, or any sub-collection nested under it that
                doesn't set its own, default their own Artist to this value.
              </p>
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="collection-season">Season # (optional)</Label>
              <Input
                id="collection-season"
                type="number"
                min="1"
                placeholder="e.g. 1"
                value={seasonNumber}
                onChange={(e) => setSeasonNumber(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                New downloads added to this collection default their own Season # to this value.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="collection-filename-template">Filename Template (optional)</Label>
            <div className="relative">
              <Input
                id="collection-filename-template"
                placeholder="e.g. {artist}/{title}"
                className="pr-8"
                value={filenameTemplate}
                onChange={(e) => setFilenameTemplate(e.target.value)}
              />
              <FilenameTemplateBuilderDialog value={filenameTemplate} onApply={setFilenameTemplate} />
            </div>
            <p className="text-xs text-muted-foreground">
              New downloads added to this collection default their own Filename Template to this
              value. Available tokens: {"{title} {uploader} {date} {artist} {year} {season} {sequence} {collection}"}
            </p>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="collection-private"
              checked={isPrivate}
              onCheckedChange={(v) => setIsPrivate(v === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="collection-private" className="font-normal">
                Private
              </Label>
              <p className="text-xs text-muted-foreground">
                Blurs thumbnails for everything in this collection, including sub-collections.
              </p>
            </div>
          </div>

          {settings?.jellyfinEnabled && (
            <div className="space-y-2">
              <Label htmlFor="collection-jellyfin-library">Jellyfin Library ID (optional)</Label>
              <Input
                id="collection-jellyfin-library"
                placeholder="e.g. 3c8f6b1a-..."
                value={jellyfinLibraryId}
                onChange={(e) => setJellyfinLibraryId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Only used when Settings → Jellyfin → Refresh is set to "Specific library" — that
                library gets refreshed after a download lands in this collection.
              </p>
            </div>
          )}
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
