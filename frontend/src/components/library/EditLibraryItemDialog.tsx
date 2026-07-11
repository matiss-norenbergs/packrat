import { Wand2 } from "lucide-react"
import { useState } from "react"
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
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useUpdateLibraryItem } from "@/hooks/useLibrary"
import { useTags } from "@/hooks/useTags"
import { parseSeasonEpisode } from "@/lib/seasonEpisode"
import { formatDuration } from "@/lib/utils"
import { ArtistSelect, NO_ARTIST } from "./ArtistSelect"
import { TagInput } from "./TagInput"
import type { LibraryItem, UpdateLibraryItemRequest } from "@/types/api"

function artistIdToSelectValue(artistId: number | null): string {
  return artistId != null ? String(artistId) : NO_ARTIST
}

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
  const [artistId, setArtistId] = useState(artistIdToSelectValue(item.artistId))
  const [year, setYear] = useState(item.year != null ? String(item.year) : "")
  const [sequenceNumber, setSequenceNumber] = useState(item.sequenceNumber != null ? String(item.sequenceNumber) : "")
  const [seasonNumber, setSeasonNumber] = useState(item.seasonNumber != null ? String(item.seasonNumber) : "")
  const [description, setDescription] = useState(item.description ?? "")
  const [originalUrl, setOriginalUrl] = useState(item.originalUrl ?? "")
  const [tags, setTags] = useState<string[]>(item.tags)
  const [generateNfo, setGenerateNfo] = useState(item.generateNfo)

  const updateLibraryItem = useUpdateLibraryItem()
  const { data: allTags } = useTags()

  const resetFields = () => {
    setTitle(item.title)
    setFilename(baseNameWithoutExt(item.filename))
    setUploader(item.uploader ?? "")
    setArtistId(artistIdToSelectValue(item.artistId))
    setYear(item.year != null ? String(item.year) : "")
    setSequenceNumber(item.sequenceNumber != null ? String(item.sequenceNumber) : "")
    setSeasonNumber(item.seasonNumber != null ? String(item.seasonNumber) : "")
    setDescription(item.description ?? "")
    setOriginalUrl(item.originalUrl ?? "")
    setTags(item.tags)
    setGenerateNfo(item.generateNfo)
  }

  const handleOpenChange = (next: boolean) => {
    if (next) resetFields()
    onOpenChange(next)
  }

  const handleDetectSeasonEpisode = () => {
    const result = parseSeasonEpisode(filename)
    if (!result) {
      toast.error("No S01E02-style season/episode pattern found in the filename")
      return
    }
    setSeasonNumber(String(result.season))
    setSequenceNumber(String(result.episode))
    toast.success(`Detected Season ${result.season}, Episode ${result.episode}`)
  }

  const handleSubmit = () => {
    const payload: UpdateLibraryItemRequest = {}

    const trimmedTitle = title.trim()
    if (trimmedTitle && trimmedTitle !== item.title) payload.title = trimmedTitle

    const trimmedFilename = filename.trim()
    if (trimmedFilename && trimmedFilename !== baseNameWithoutExt(item.filename)) payload.filename = trimmedFilename

    const trimmedUploader = uploader.trim()
    if (trimmedUploader !== (item.uploader ?? "")) payload.uploader = trimmedUploader

    const initialArtistId = artistIdToSelectValue(item.artistId)
    if (artistId !== initialArtistId) payload.artistId = artistId === NO_ARTIST ? 0 : Number(artistId)

    const parsedYear = year.trim() === "" ? null : Number(year)
    if (parsedYear !== item.year && parsedYear != null && !Number.isNaN(parsedYear)) {
      payload.year = parsedYear
    }

    const parsedSequenceNumber = sequenceNumber.trim() === "" ? null : Number(sequenceNumber)
    if (parsedSequenceNumber !== item.sequenceNumber && parsedSequenceNumber != null && !Number.isNaN(parsedSequenceNumber)) {
      payload.sequenceNumber = parsedSequenceNumber
    }

    const parsedSeasonNumber = seasonNumber.trim() === "" ? null : Number(seasonNumber)
    if (parsedSeasonNumber !== item.seasonNumber && parsedSeasonNumber != null && !Number.isNaN(parsedSeasonNumber)) {
      payload.seasonNumber = parsedSeasonNumber
    }

    const trimmedDescription = description.trim()
    if (trimmedDescription !== (item.description ?? "")) payload.description = trimmedDescription

    const trimmedOriginalUrl = originalUrl.trim()
    if (trimmedOriginalUrl !== (item.originalUrl ?? "")) payload.originalUrl = trimmedOriginalUrl

    // Array identity won't work for the diff — compare contents, not order.
    const tagsKey = (arr: string[]) => [...arr].sort().join("|")
    if (tagsKey(tags) !== tagsKey(item.tags)) payload.tags = tags

    if (generateNfo !== item.generateNfo) payload.generateNfo = generateNfo

    if (Object.keys(payload).length === 0) {
      onOpenChange(false)
      return
    }
    updateLibraryItem.mutate({ id: item.id, payload }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit</DialogTitle>
          <DialogDescription>
            Changing the filename also renames the actual media file and thumbnail on disk (the
            extension is kept).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              App Details
            </h3>
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-filename">Filename (without extension)</Label>
              <div className="flex gap-2">
                <Input
                  id="edit-filename"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleDetectSeasonEpisode}
                  title="Detect Season/Episode from filename (e.g. S01E02)"
                  aria-label="Detect Season/Episode from filename"
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-uploader">Uploader</Label>
              <Input id="edit-uploader" value={uploader} onChange={(e) => setUploader(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                rows={6}
                className="max-h-56 overflow-y-auto"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <TagInput value={tags} onChange={setTags} suggestions={allTags?.map((t) => t.name) ?? []} />
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

            <div className="flex items-start gap-2">
              <Checkbox
                id="edit-generate-nfo"
                checked={generateNfo}
                onCheckedChange={(v) => setGenerateNfo(v === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="edit-generate-nfo" className="font-normal">
                  Generate NFO
                </Label>
                <p className="text-xs text-muted-foreground">
                  Writes a <code>{baseNameWithoutExt(item.filename)}.nfo</code> file Jellyfin can
                  read for title/plot/year/tags/sequence — kept in sync automatically whenever you
                  save changes here.
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Downloaded {new Date(item.downloadedAt).toLocaleString()}
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              File Metadata
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="edit-resolution" className="text-xs text-muted-foreground">
                  Resolution
                </Label>
                <Input
                  id="edit-resolution"
                  value={item.resolution ?? "—"}
                  disabled
                  className="h-8 bg-muted/30 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-duration" className="text-xs text-muted-foreground">
                  Duration
                </Label>
                <Input
                  id="edit-duration"
                  value={item.duration != null ? formatDuration(item.duration) : "—"}
                  disabled
                  className="h-8 bg-muted/30 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-artist">Artist</Label>
                <ArtistSelect value={artistId} onValueChange={setArtistId} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-year">Year</Label>
                <Input id="edit-year" type="number" placeholder="2024" value={year} onChange={(e) => setYear(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-season-number">Season #</Label>
                <Input
                  id="edit-season-number"
                  type="number"
                  min="1"
                  placeholder="e.g. 1"
                  value={seasonNumber}
                  onChange={(e) => setSeasonNumber(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-sequence-number">Sequence #</Label>
                <Input
                  id="edit-sequence-number"
                  type="number"
                  min="1"
                  placeholder="e.g. 3"
                  value={sequenceNumber}
                  onChange={(e) => setSequenceNumber(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Title, Artist, Year, Season #, and Sequence # are also written into the file's own
              metadata tags on save.
            </p>
          </div>
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
