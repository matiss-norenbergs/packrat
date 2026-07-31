import { RefreshCw, Wand2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useArtists } from "@/hooks/useArtists"
import { useCollections } from "@/hooks/useCollections"
import { useLibraryQuery, useUpdateLibraryItem } from "@/hooks/useLibrary"
import { useTags } from "@/hooks/useTags"
import { libraryMediumThumbnailUrl } from "@/lib/api"
import { artistIdToSelectValue, baseNameWithoutExt, buildLibraryItemUpdatePayload } from "@/lib/libraryItemEdit"
import { resolveFilenameTemplatePreview } from "@/lib/nametemplate"
import { parseSeasonEpisode } from "@/lib/seasonEpisode"
import { computeSequenceGaps } from "@/lib/sequenceGaps"
import { formatDuration } from "@/lib/utils"
import { ArtistSelect, NO_ARTIST } from "./ArtistSelect"
import { useRevealAll } from "./RevealAllContext"
import { SequenceNumberField } from "./SequenceNumberField"
import { TagInput } from "./TagInput"
import type { LibraryItem } from "@/types/api"

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
  const { data: collections } = useCollections()
  const { data: artists } = useArtists()
  const { isRevealed, toggleItem: toggleReveal } = useRevealAll()
  const revealed = isRevealed(item.id)

  const itemCollection = collections?.find((c) => c.id === item.collectionId)
  const sequenceMin = itemCollection?.sequenceMin
  const sequenceMax = itemCollection?.sequenceMax
  const artistName = artistId === NO_ARTIST ? "" : (artists?.find((a) => String(a.id) === artistId)?.name ?? "")

  // Siblings in the same collection, fetched only while the dialog is open —
  // used to show which sequence numbers are already taken/missing. Overlays
  // this item's own in-progress form value below, so the hint answers "if I
  // save this number" rather than only ever showing the stale pre-edit state.
  // Superseded by SequenceNumberField's own picker once sequenceMax is set
  // (the 1..max option list already conveys this), so this hint is only
  // computed/shown when there's no configured max.
  const { data: siblings } = useLibraryQuery(
    { collectionId: item.collectionId ?? undefined },
    open && item.collectionId != null && sequenceMax == null,
  )
  const parsedSequenceNumber = sequenceNumber.trim() === "" ? null : Number(sequenceNumber)
  const sequenceGapInfo = computeSequenceGaps(
    (siblings?.items ?? []).map((s) =>
      s.id === item.id ? { sequenceNumber: parsedSequenceNumber } : { sequenceNumber: s.sequenceNumber },
    ),
  )

  // `open` is set externally (the row's dropdown item flips it straight to
  // true, not via a DialogTrigger), so Radix's own onOpenChange never fires
  // on open — only on internally-triggered closes (Escape, overlay, the X
  // button). A plain useEffect is what actually catches every open; without
  // it, fields kept whatever was last typed from a previous open-without-save.
  useEffect(() => {
    if (!open) return
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item])

  const handleDetectSeason = () => {
    const result = parseSeasonEpisode(filename)
    if (!result) {
      toast.error("No S01E02-style season/episode pattern found in the filename")
      return
    }
    setSeasonNumber(String(result.season))
    toast.success(`Detected Season ${result.season}`)
  }

  const handleDetectSequence = () => {
    const result = parseSeasonEpisode(filename)
    if (!result) {
      toast.error("No S01E02-style season/episode pattern found in the filename")
      return
    }
    setSequenceNumber(String(result.episode))
    toast.success(`Detected Episode ${result.episode}`)
  }

  const handleReconstructFilename = () => {
    if (!itemCollection?.filenameTemplate) {
      toast.error("This item's collection has no filename template set")
      return
    }
    setFilename(
      resolveFilenameTemplatePreview(itemCollection.filenameTemplate, {
        title,
        uploader,
        uploadDate: item.downloadedAt,
        artist: artistName,
        year,
        season: seasonNumber,
        sequence: sequenceNumber,
        collection: item.collectionName ?? "",
      }),
    )
  }

  const handleSubmit = () => {
    const payload = buildLibraryItemUpdatePayload(item, {
      title,
      filename,
      uploader,
      artistId,
      year,
      sequenceNumber,
      seasonNumber,
      description,
      originalUrl,
      tags,
      generateNfo,
    })

    if (Object.keys(payload).length === 0) {
      onOpenChange(false)
      return
    }
    updateLibraryItem.mutate({ id: item.id, payload }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              <div className="relative">
                <Input
                  id="edit-filename"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="pr-8"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={handleReconstructFilename}
                      aria-label="Reconstruct from collection's filename template"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reconstruct from the collection's filename template</TooltipContent>
                </Tooltip>
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
            {item.thumbnail && (
              <div className="overflow-hidden rounded-md border bg-muted">
                <BlurredThumbnail
                  src={libraryMediumThumbnailUrl(item)!}
                  className="aspect-video w-full object-cover"
                  blurred={item.blurred}
                  revealed={revealed}
                  onToggleReveal={() => toggleReveal(item.id)}
                />
              </div>
            )}

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
                <div className="relative">
                  <Input
                    id="edit-season-number"
                    type="number"
                    min="1"
                    placeholder="e.g. 1"
                    className="pr-8"
                    value={seasonNumber}
                    onChange={(e) => setSeasonNumber(e.target.value)}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={handleDetectSeason}
                        aria-label="Detect Season from filename"
                      >
                        <Wand2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Detect from filename (e.g. S01E02)</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-sequence-number">Sequence #</Label>
                {sequenceMax == null ? (
                  <div className="relative">
                    <SequenceNumberField
                      id="edit-sequence-number"
                      value={sequenceNumber}
                      onChange={setSequenceNumber}
                      sequenceMax={sequenceMax}
                      sequenceMin={sequenceMin}
                      className="pr-8"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={handleDetectSequence}
                          aria-label="Detect Episode from filename"
                        >
                          <Wand2 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Detect from filename (e.g. S01E02)</TooltipContent>
                    </Tooltip>
                  </div>
                ) : (
                  <SequenceNumberField
                    id="edit-sequence-number"
                    value={sequenceNumber}
                    onChange={setSequenceNumber}
                    sequenceMax={sequenceMax}
                    sequenceMin={sequenceMin}
                  />
                )}
              </div>
            </div>
            {sequenceMax == null && sequenceGapInfo && (
              <p className="text-xs text-muted-foreground">
                Sequence {sequenceGapInfo.min}–{sequenceGapInfo.max} · Missing:{" "}
                {sequenceGapInfo.missing.length === 0
                  ? "none"
                  : sequenceGapInfo.missing.slice(0, 10).join(", ") +
                    (sequenceGapInfo.missing.length > 10 ? ` (+${sequenceGapInfo.missing.length - 10} more)` : "")}
              </p>
            )}
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
