import { useEffect, useState } from "react"
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
import { InfoPopover } from "@/components/ui/info-popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ResolutionValue } from "@/components/ResolutionValue"
import { useCollections } from "@/hooks/useCollections"
import { useDownloadPreview } from "@/hooks/useDownloads"
import { useCreateGhostLibraryItem } from "@/hooks/useLibrary"
import { useTags } from "@/hooks/useTags"
import { sortCollectionsByPath } from "@/lib/collectionTree"
import { formatDuration } from "@/lib/utils"
import { ArtistSelect, NO_ARTIST } from "./ArtistSelect"
import { SequenceNumberField } from "./SequenceNumberField"
import { TagInput } from "./TagInput"

const NO_COLLECTION = "none"

interface AddGhostLibraryItemDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Adds a "ghost" library item — a row with no downloaded file yet, shown as
// a type placeholder until a later "Download now" fills it in (see
// LibraryItemActionsMenu's ghost-aware Redownload relabel). The optional
// URL step reuses the exact same metadata-preview machinery the New
// Download dialog uses (useDownloadPreview) — no file is ever fetched here,
// only metadata and, if requested, a thumbnail.
export function AddGhostLibraryItemDialog({ open, onOpenChange }: AddGhostLibraryItemDialogProps) {
  const [title, setTitle] = useState("")
  const [mediaType, setMediaType] = useState<"video" | "audio">("video")
  const [url, setUrl] = useState("")
  const [debouncedUrl, setDebouncedUrl] = useState("")
  const [fetchThumbnail, setFetchThumbnail] = useState(true)
  const [collectionId, setCollectionId] = useState(NO_COLLECTION)
  const [artistId, setArtistId] = useState(NO_ARTIST)
  const [year, setYear] = useState("")
  const [seasonNumber, setSeasonNumber] = useState("")
  const [sequenceNumber, setSequenceNumber] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [generateNfo, setGenerateNfo] = useState(false)

  const { data: collections } = useCollections()
  const { data: allTags } = useTags()
  const createGhostLibraryItem = useCreateGhostLibraryItem()

  const trimmedUrl = url.trim()
  const looksLikeUrl = trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")
  const { data: preview, isLoading: previewLoading, isError: previewError } = useDownloadPreview(debouncedUrl, looksLikeUrl)
  const previewPending = looksLikeUrl && (!debouncedUrl || previewLoading)

  useEffect(() => {
    if (!looksLikeUrl) {
      setDebouncedUrl("")
      return
    }
    const timer = setTimeout(() => setDebouncedUrl(trimmedUrl), 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  // Prefills Title from the fetched metadata the first time a preview
  // resolves — never overwrites something the user already typed.
  useEffect(() => {
    if (preview && !preview.isPlaylist) {
      setTitle((t) => t || preview.title)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])

  const itemCollection = collections?.find((c) => String(c.id) === collectionId)

  const handleCollectionChange = (value: string) => {
    setCollectionId(value)
    const collection = collections?.find((c) => String(c.id) === value)
    // Ghost items don't support "image" — a collection defaulted to Image
    // just leaves the current video/audio selection alone.
    if (collection && collection.defaultDownloadType !== "image") setMediaType(collection.defaultDownloadType)
  }

  const reset = () => {
    setTitle("")
    setMediaType("video")
    setUrl("")
    setDebouncedUrl("")
    setFetchThumbnail(true)
    setCollectionId(NO_COLLECTION)
    setArtistId(NO_ARTIST)
    setYear("")
    setSeasonNumber("")
    setSequenceNumber("")
    setTags([])
    setGenerateNfo(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleSubmit = () => {
    if (!title.trim()) return
    createGhostLibraryItem.mutate(
      {
        title: title.trim(),
        mediaType,
        originalUrl: trimmedUrl || undefined,
        collectionId: collectionId === NO_COLLECTION ? undefined : Number(collectionId),
        artistId: artistId === NO_ARTIST ? undefined : Number(artistId),
        year: year.trim() ? Number(year) : undefined,
        seasonNumber: seasonNumber.trim() ? Number(seasonNumber) : undefined,
        sequenceNumber: sequenceNumber.trim() ? Number(sequenceNumber) : undefined,
        generateNfo,
        tags: tags.length > 0 ? tags : undefined,
        fetchThumbnail: !!trimmedUrl && fetchThumbnail,
      },
      { onSuccess: () => handleOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add item</DialogTitle>
          <DialogDescription>
            Creates a placeholder library item with no file yet — download it later from its
            actions menu.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ghost-url">Source URL (optional)</Label>
            <Input
              id="ghost-url"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
          </div>

          {looksLikeUrl && (
            <div className="rounded-md border p-3">
              {previewPending ? (
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-20 shrink-0 rounded" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ) : previewError ? (
                <p className="text-xs text-muted-foreground">
                  Couldn't fetch a preview for this URL — you can still add the item.
                </p>
              ) : preview && !preview.isPlaylist ? (
                <div className="flex items-center gap-3">
                  {preview.thumbnail ? (
                    <img src={preview.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded bg-muted object-cover" />
                  ) : (
                    <div className="h-12 w-20 shrink-0 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 break-words text-sm font-medium">{preview.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {preview.uploader || "Unknown uploader"}
                      {preview.duration > 0 && ` · ${formatDuration(preview.duration)}`}
                      {preview.resolution && (
                        <>
                          {" · "}
                          <ResolutionValue resolution={preview.resolution} />
                        </>
                      )}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {trimmedUrl && (
            <div className="flex items-center gap-1.5">
              <Checkbox id="ghost-fetch-thumbnail" checked={fetchThumbnail} onCheckedChange={(v) => setFetchThumbnail(v === true)} />
              <Label htmlFor="ghost-fetch-thumbnail" className="font-normal">
                Fetch thumbnail from this URL
              </Label>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="ghost-title">Title</Label>
            <Input id="ghost-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={mediaType} onValueChange={(v) => setMediaType(v as "video" | "audio")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="audio">Audio</SelectItem>
                </SelectContent>
              </Select>
              <InfoPopover>
                No file exists yet, so this can't be detected automatically — it just picks the
                placeholder icon shown until the item is downloaded.
              </InfoPopover>
            </div>
            <div className="space-y-2">
              <Label>Collection</Label>
              <Select value={collectionId} onValueChange={handleCollectionChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COLLECTION}>None</SelectItem>
                  <SelectSeparator />
                  {sortCollectionsByPath(collections ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ghost-artist">Artist</Label>
              <ArtistSelect value={artistId} onValueChange={setArtistId} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ghost-year">Year</Label>
              <Input id="ghost-year" type="number" placeholder="2024" value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ghost-season-number">Season #</Label>
              <Input
                id="ghost-season-number"
                type="number"
                min="1"
                placeholder="e.g. 1"
                value={seasonNumber}
                onChange={(e) => setSeasonNumber(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ghost-sequence-number">Sequence #</Label>
              <SequenceNumberField
                id="ghost-sequence-number"
                value={sequenceNumber}
                onChange={setSequenceNumber}
                sequenceMax={itemCollection?.sequenceMax}
                sequenceMin={itemCollection?.sequenceMin}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <TagInput value={tags} onChange={setTags} suggestions={allTags?.map((t) => t.name) ?? []} />
          </div>

          <div className="flex items-center gap-1.5">
            <Checkbox id="ghost-generate-nfo" checked={generateNfo} onCheckedChange={(v) => setGenerateNfo(v === true)} />
            <Label htmlFor="ghost-generate-nfo" className="font-normal">
              Generate NFO
            </Label>
            <InfoPopover>
              Only takes effect once this item has a downloaded file — a placeholder has nothing
              to write a sidecar next to yet.
            </InfoPopover>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!title.trim() || createGhostLibraryItem.isPending}>
            {createGhostLibraryItem.isPending ? "Adding…" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
