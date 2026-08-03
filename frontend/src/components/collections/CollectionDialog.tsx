import { useState, type ReactNode } from "react"
import { Eye, EyeOff, ImageIcon, Plus, X } from "lucide-react"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
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
import { FieldLabel } from "@/components/ui/info-popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useCreateCollection, useDeleteCollectionCover, useUpdateCollection } from "@/hooks/useCollections"
import { useSettings } from "@/hooks/useSettings"
import { ArtistSelect, NO_ARTIST } from "@/components/library/ArtistSelect"
import { CollectionCoverDialog } from "./CollectionCoverDialog"
import { FilenameTemplateBuilderDialog } from "@/components/downloads/FilenameTemplateBuilderDialog"
import { collectionMediumCoverUrl } from "@/lib/api"
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
  const [year, setYear] = useState(collection?.year != null ? String(collection.year) : "")
  const [sequenceMin, setSequenceMin] = useState(collection?.sequenceMin != null ? String(collection.sequenceMin) : "")
  const [sequenceMax, setSequenceMax] = useState(collection?.sequenceMax != null ? String(collection.sequenceMax) : "")
  const [artistId, setArtistId] = useState(collection?.artistId != null ? String(collection.artistId) : NO_ARTIST)
  const [filenameTemplate, setFilenameTemplate] = useState(collection?.filenameTemplate ?? "")
  const [browseAsShow, setBrowseAsShow] = useState(collection?.browseAsShow ?? false)
  const [coverDialogOpen, setCoverDialogOpen] = useState(false)
  const [coverRevealed, setCoverRevealed] = useState(false)

  const { data: settings } = useSettings()
  const createCollection = useCreateCollection()
  const updateCollection = useUpdateCollection()
  const deleteCover = useDeleteCollectionCover(collection?.id ?? 0)
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
      setYear(collection?.year != null ? String(collection.year) : "")
      setSequenceMin(collection?.sequenceMin != null ? String(collection.sequenceMin) : "")
      setSequenceMax(collection?.sequenceMax != null ? String(collection.sequenceMax) : "")
      setArtistId(collection?.artistId != null ? String(collection.artistId) : NO_ARTIST)
      setFilenameTemplate(collection?.filenameTemplate ?? "")
      setBrowseAsShow(collection?.browseAsShow ?? false)
      setCoverRevealed(false)
    }
    setOpen(next)
  }

  const handleSubmit = () => {
    if (!name.trim() || !rootPath.trim()) return
    const parsedSeason = seasonNumber.trim() === "" ? null : Number(seasonNumber)
    const parsedYear = year.trim() === "" ? null : Number(year)
    const parsedSequenceMin = sequenceMin.trim() === "" ? null : Number(sequenceMin)
    const parsedSequenceMax = sequenceMax.trim() === "" ? null : Number(sequenceMax)
    const payload = {
      name: name.trim(),
      rootPath: rootPath.trim(),
      defaultQuality,
      defaultDownloadType,
      isPrivate,
      jellyfinLibraryId: jellyfinLibraryId.trim() || null,
      seasonNumber: parsedSeason != null && !Number.isNaN(parsedSeason) ? parsedSeason : null,
      year: parsedYear != null && !Number.isNaN(parsedYear) ? parsedYear : null,
      sequenceMin: parsedSequenceMin != null && !Number.isNaN(parsedSequenceMin) ? parsedSequenceMin : null,
      sequenceMax: parsedSequenceMax != null && !Number.isNaN(parsedSequenceMax) ? parsedSequenceMax : null,
      artistId: artistId === NO_ARTIST ? null : Number(artistId),
      filenameTemplate: filenameTemplate.trim() || undefined,
      browseAsShow,
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
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
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

          <div className="grid gap-6 sm:grid-cols-2">
            {/* Core fields — always relevant, no defaults to fall back on for
                name/folder, so these stay on their own side of the divider
                rather than mixed in with the opt-in extras on the right. */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="collection-name">Name</Label>
                <Input
                  id="collection-name"
                  placeholder="Music"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
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

              {isEdit && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium whitespace-nowrap">Cover art</span>
                    {isPrivate && collection.coverImagePath && (
                      <button
                        type="button"
                        onClick={() => setCoverRevealed((v) => !v)}
                        aria-label={coverRevealed ? "Hide cover art" : "Reveal cover art"}
                        className="text-muted-foreground transition hover:text-foreground"
                      >
                        {coverRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    <Separator className="flex-1" />
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setCoverDialogOpen(true)}
                    onKeyDown={(e) => e.key === "Enter" && setCoverDialogOpen(true)}
                    className="group relative aspect-video w-full cursor-pointer overflow-hidden rounded-md border bg-muted"
                  >
                    {collection.coverImagePath ? (
                      <>
                        <BlurredThumbnail
                          src={collectionMediumCoverUrl(collection)!}
                          className="h-full w-full object-cover"
                          blurred={isPrivate}
                          revealed={coverRevealed}
                          onToggleReveal={() => setCoverRevealed((v) => !v)}
                          interactive={false}
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteCover.mutate()
                              }}
                              disabled={deleteCover.isPending}
                              className="absolute top-1.5 right-1.5 rounded-full bg-black/70 p-1 text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-50"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Remove cover</TooltipContent>
                        </Tooltip>
                      </>
                    ) : (
                      <>
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
                        </div>
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition group-hover:opacity-100">
                          <span className="text-sm font-medium text-white">Select cover</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Optional / opt-in fields — everything here can be left at its
                default with no effect on downloads landing in this collection. */}
            <div className="space-y-4 sm:border-l sm:pl-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <FieldLabel
                    htmlFor="collection-artist"
                    info="New downloads added to this collection, or any sub-collection nested under it
                    that doesn't set its own, default their own Artist to this value."
                  >
                    Artist
                  </FieldLabel>
                  <ArtistSelect value={artistId} onValueChange={setArtistId} />
                </div>
                <div className="space-y-2">
                  <FieldLabel
                    htmlFor="collection-year"
                    info="New downloads added directly to this collection default their own Year to
                    this value."
                  >
                    Year
                  </FieldLabel>
                  <Input
                    id="collection-year"
                    type="number"
                    placeholder="2024"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel
                    htmlFor="collection-season"
                    info="New downloads added to this collection default their own Season # to this
                    value."
                  >
                    Season #
                  </FieldLabel>
                  <Input
                    id="collection-season"
                    type="number"
                    min="1"
                    placeholder="e.g. 1"
                    value={seasonNumber}
                    onChange={(e) => setSeasonNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel
                    htmlFor="collection-sequence-min"
                    info="Sets the expected range of items in this collection — leave the first box blank
                    to assume it starts at 1. Once the range is set, Sequence # fields for items here
                    become a picker instead of a free number, and the Edit Sequence dialog shows the
                    full range including slots you haven't reached yet."
                  >
                    Sequence range
                  </FieldLabel>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="collection-sequence-min"
                      type="number"
                      min="1"
                      placeholder="1"
                      value={sequenceMin}
                      onChange={(e) => setSequenceMin(e.target.value)}
                    />
                    <span className="shrink-0 text-muted-foreground">–</span>
                    <Input
                      id="collection-sequence-max"
                      type="number"
                      min="1"
                      placeholder="12"
                      value={sequenceMax}
                      onChange={(e) => setSequenceMax(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <FieldLabel
                  htmlFor="collection-filename-template"
                  info={
                    <>
                      New downloads added to this collection default their own Filename Template to this
                      value. Available tokens:{" "}
                      {"{title} {uploader} {date} {artist} {year} {season} {sequence} {collection}"}
                    </>
                  }
                >
                  Filename Template
                </FieldLabel>
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
              </div>

              {settings?.privacyEnabled && (
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
              )}

              <div className="flex items-start gap-2">
                <Checkbox
                  id="collection-browse-as-show"
                  checked={browseAsShow}
                  onCheckedChange={(v) => setBrowseAsShow(v === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="collection-browse-as-show" className="font-normal">
                    Show as single item in Browse
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Groups everything in this collection (and its sub-collections) behind one
                    cover tile on the Browse page, instead of listing each item separately.
                  </p>
                </div>
              </div>

              {settings?.jellyfinEnabled && (
                <div className="space-y-2">
                  <FieldLabel
                    htmlFor="collection-jellyfin-library"
                    info='Only used when Settings → Jellyfin → Refresh is set to "Specific library" — that
                    library gets refreshed after a download lands in this collection.'
                  >
                    Jellyfin Library ID
                  </FieldLabel>
                  <Input
                    id="collection-jellyfin-library"
                    placeholder="e.g. 3c8f6b1a-..."
                    value={jellyfinLibraryId}
                    onChange={(e) => setJellyfinLibraryId(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!name.trim() || !rootPath.trim() || pending}>
            {pending ? "Saving…" : isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>

        {isEdit && (
          <CollectionCoverDialog collectionId={collection.id} open={coverDialogOpen} onOpenChange={setCoverDialogOpen} />
        )}
      </DialogContent>
    </Dialog>
  )
}
