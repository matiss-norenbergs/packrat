import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Plus } from "lucide-react"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useCreateDownload, useCreatePlaylistDownload, useDownloadPreview } from "@/hooks/useDownloads"
import { useCollections } from "@/hooks/useCollections"
import { useDeleteLibraryItem } from "@/hooks/useLibrary"
import { useArtists } from "@/hooks/useArtists"
import { useMediaQuery } from "@/hooks/useMediaQuery"
import { useSettings } from "@/hooks/useSettings"
import { useTags } from "@/hooks/useTags"
import { cn, formatDuration } from "@/lib/utils"
import { resolveFilenameTemplatePreview } from "@/lib/nametemplate"
import { resolveInheritedArtistId, sortCollectionsByPath } from "@/lib/collectionTree"
import { invalidSegmentChars, invalidTemplateChars } from "@/lib/filenameValidation"
import { ArtistSelect, NO_ARTIST } from "@/components/library/ArtistSelect"
import { SequenceNumberField } from "@/components/library/SequenceNumberField"
import { TagInput } from "@/components/library/TagInput"
import { FilenameCharWarning } from "./FilenameCharWarning"
import { FilenameTemplateBuilderDialog } from "./FilenameTemplateBuilderDialog"
import type { AudioFormat, DownloadType, PlaylistMode, VideoQuality } from "@/types/api"

const VIDEO_QUALITIES: VideoQuality[] = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"]
const AUDIO_FORMATS: AudioFormat[] = ["mp3", "flac", "m4a", "aac", "wav"]
const NO_COLLECTION = "none"

const PLAYLIST_MODE_OPTIONS: { value: PlaylistMode; label: string }[] = [
  { value: "entire", label: "Entire playlist" },
  { value: "current", label: "Only this video" },
  { value: "range", label: "Range" },
  { value: "first_n", label: "First N" },
]

// Available {variable} tokens for the Filename Template field, in the order
// shown as insert-buttons below the input.
const FILENAME_TEMPLATE_TOKENS = [
  "{title}",
  "{artist}",
  "{uploader}",
  "{date}",
  "{year}",
  "{season}",
  "{sequence}",
  "{collection}",
] as const

export function NewDownloadDialog() {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [collectionId, setCollectionId] = useState(NO_COLLECTION)
  const [downloadType, setDownloadType] = useState<DownloadType>("video")
  const [quality, setQuality] = useState<VideoQuality>("best")
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("mp3")
  const [filename, setFilename] = useState("")
  const [debouncedUrl, setDebouncedUrl] = useState("")

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [titleOverride, setTitleOverride] = useState("")
  const [artistId, setArtistId] = useState(NO_ARTIST)
  const [year, setYear] = useState("")
  const [seasonNumber, setSeasonNumber] = useState("")
  const [sequenceNumber, setSequenceNumber] = useState("")
  const [filenameTemplate, setFilenameTemplate] = useState("")
  const [tags, setTags] = useState<string[]>([])

  const [playlistMode, setPlaylistMode] = useState<PlaylistMode>("entire")
  const [playlistStart, setPlaylistStart] = useState("")
  const [playlistEnd, setPlaylistEnd] = useState("")
  const [playlistLimit, setPlaylistLimit] = useState("")
  const [skipDuplicates, setSkipDuplicates] = useState(true)

  const { data: collections } = useCollections()
  const { data: artists } = useArtists()
  const { data: settings } = useSettings()
  const { data: allTags } = useTags()
  const createDownload = useCreateDownload()
  const createPlaylistDownload = useCreatePlaylistDownload()
  const deleteLibraryItem = useDeleteLibraryItem()

  // On wide viewports, Advanced moves to a non-collapsible right-hand column
  // instead of a collapsible section below — matches Tailwind's default lg
  // breakpoint (1024px).
  const isWideScreen = useMediaQuery("(min-width: 1024px)")

  const previewEnabled = !settings?.skipDownloadPreview
  const { data: preview, isLoading: previewLoading, isError: previewError } =
    useDownloadPreview(debouncedUrl, previewEnabled)

  // Playlists never show Advanced at all, so the two-column layout (and the
  // wider dialog that goes with it) never activates in that mode either —
  // nothing would fill a second column.
  const showTwoColumn = isWideScreen && !preview?.isPlaylist

  // Whether the pasted URL looks fetchable — computed from the raw (not
  // debounced) url, so the preview box's presence doesn't wait out the
  // debounce window before appearing. Showing the box (with a skeleton)
  // the instant this goes true, rather than once debouncedUrl/the fetch
  // resolves, is what keeps the rest of the form from jumping later: the
  // box's mere appearance was the layout shift, not the swap from skeleton
  // to real content within an already-present box.
  const trimmedUrl = url.trim()
  const looksLikeUrl = trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")
  const showPreviewBox = previewEnabled && looksLikeUrl
  // Still debouncing (or the debounced fetch hasn't started yet) counts as
  // loading too — useDownloadPreview's query is disabled until debouncedUrl
  // is set, so previewLoading alone would report false during that window.
  const previewPending = !debouncedUrl || previewLoading

  useEffect(() => {
    if (!looksLikeUrl) {
      setDebouncedUrl("")
      return
    }
    const timer = setTimeout(() => setDebouncedUrl(trimmedUrl), 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const reset = () => {
    setUrl("")
    setDebouncedUrl("")
    setCollectionId(NO_COLLECTION)
    setDownloadType(settings?.defaultDownloadType ?? "video")
    setQuality((settings?.defaultQuality as VideoQuality) ?? "best")
    setAudioFormat("mp3")
    setFilename("")
    setAdvancedOpen(false)
    setTitleOverride("")
    setArtistId(NO_ARTIST)
    setYear("")
    setSeasonNumber("")
    setSequenceNumber("")
    setFilenameTemplate("")
    setTags([])
    setPlaylistMode("entire")
    setPlaylistStart("")
    setPlaylistEnd("")
    setPlaylistLimit("")
    setSkipDuplicates(true)
  }

  const handleOpenChange = (next: boolean) => {
    if (next) reset()
    setOpen(next)
  }

  const handleCollectionChange = (value: string) => {
    setCollectionId(value)
    const collection = collections?.find((c) => String(c.id) === value)
    if (collection) {
      setDownloadType(collection.defaultDownloadType)
      setQuality(collection.defaultQuality as VideoQuality)
      if (collection.seasonNumber != null) {
        setSeasonNumber(String(collection.seasonNumber))
        setAdvancedOpen(true)
      }
      if (collection.year != null) {
        setYear(String(collection.year))
        setAdvancedOpen(true)
      }
      const inheritedArtistId = resolveInheritedArtistId(collections ?? [], collection.id)
      if (inheritedArtistId != null) {
        setArtistId(String(inheritedArtistId))
        setAdvancedOpen(true)
      }
      if (!filenameTemplate.trim() && collection.filenameTemplate) {
        setFilenameTemplate(collection.filenameTemplate)
        setAdvancedOpen(true)
      }
    }
  }

  const artistName = artistId === NO_ARTIST ? "" : (artists?.find((a) => String(a.id) === artistId)?.name ?? "")
  const selectedCollection = collectionId === NO_COLLECTION ? undefined : collections?.find((c) => String(c.id) === collectionId)
  const collectionName = selectedCollection?.name ?? ""
  const previewTitle = titleOverride.trim() || preview?.title
  const filenameTemplatePreview = resolveFilenameTemplatePreview(filenameTemplate, {
    title: previewTitle,
    uploader: preview?.uploader,
    uploadDate: preview?.uploadDate,
    artist: artistName,
    year,
    season: seasonNumber,
    sequence: sequenceNumber,
    collection: collectionName,
  })

  const handleSubmit = () => {
    if (!url.trim()) return

    const parsedYear = year.trim() === "" ? undefined : Number(year)
    const parsedSeason = seasonNumber.trim() === "" ? undefined : Number(seasonNumber)
    const parsedSequence = sequenceNumber.trim() === "" ? undefined : Number(sequenceNumber)

    createDownload.mutate(
      {
        url: url.trim(),
        collectionId: collectionId === NO_COLLECTION ? undefined : Number(collectionId),
        downloadType,
        quality: downloadType === "video" ? quality : undefined,
        audioFormat: downloadType === "audio" ? audioFormat : undefined,
        filename: filename.trim() || undefined,
        title: titleOverride.trim() || undefined,
        artistId: artistId === NO_ARTIST ? undefined : Number(artistId),
        year: parsedYear != null && !Number.isNaN(parsedYear) ? parsedYear : undefined,
        seasonNumber: parsedSeason != null && !Number.isNaN(parsedSeason) ? parsedSeason : undefined,
        sequenceNumber: parsedSequence != null && !Number.isNaN(parsedSequence) ? parsedSequence : undefined,
        filenameTemplate: filenameTemplate.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
      },
      {
        onSuccess: () => {
          setOpen(false)
          reset()
        },
      },
    )
  }

  const handleQueuePlaylist = () => {
    if (!url.trim()) return

    const parsedStart = playlistStart.trim() === "" ? undefined : Number(playlistStart)
    const parsedEnd = playlistEnd.trim() === "" ? undefined : Number(playlistEnd)
    const parsedLimit = playlistLimit.trim() === "" ? undefined : Number(playlistLimit)

    createPlaylistDownload.mutate(
      {
        url: url.trim(),
        collectionId: collectionId === NO_COLLECTION ? undefined : Number(collectionId),
        downloadType,
        quality: downloadType === "video" ? quality : undefined,
        audioFormat: downloadType === "audio" ? audioFormat : undefined,
        playlistMode,
        playlistStart: parsedStart,
        playlistEnd: parsedEnd,
        playlistLimit: parsedLimit,
        skipDuplicates,
      },
      {
        onSuccess: (result) => {
          const parts = [`${result.queued.length} queued`]
          if (result.skipped.length > 0) parts.push(`${result.skipped.length} already in library`)
          if (result.failed.length > 0) parts.push(`${result.failed.length} failed`)
          if (result.failed.length > 0) toast.error(parts.join(", "))
          else toast.success(parts.join(", "))
          setOpen(false)
          reset()
        },
      },
    )
  }

  const handleSkipDuplicate = () => setOpen(false)

  const handleReplaceAndDownload = () => {
    if (!preview?.duplicate) return
    deleteLibraryItem.mutate(
      { id: preview.duplicate.libraryItemId, deleteFiles: true },
      { onSuccess: handleSubmit },
    )
  }

  // Shared between the wide-viewport (always-visible right column) and
  // narrow-viewport (collapsible section) renderings below — computed once
  // so the two layouts never duplicate this field markup.
  const advancedFields = (
    <>
      <p className="text-xs text-muted-foreground">
        Optional overrides — when set, used instead of whatever yt-dlp reports for that
        field, and written into the file's own metadata tags once the download
        completes.
      </p>

      <div className="space-y-2">
        <Label htmlFor="dl-title">Title</Label>
        <Input
          id="dl-title"
          placeholder={preview?.title || "Video title"}
          value={titleOverride}
          onChange={(e) => setTitleOverride(e.target.value)}
        />
        {!filename.trim() && !filenameTemplate.trim() && (
          <FilenameCharWarning chars={invalidSegmentChars(titleOverride)} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="dl-artist">Artist</Label>
          <ArtistSelect value={artistId} onValueChange={setArtistId} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dl-year">Year</Label>
          <Input
            id="dl-year"
            type="number"
            placeholder="2024"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dl-season">Season #</Label>
          <Input
            id="dl-season"
            type="number"
            min="1"
            placeholder="e.g. 1"
            value={seasonNumber}
            onChange={(e) => setSeasonNumber(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dl-sequence">Sequence #</Label>
          <SequenceNumberField
            id="dl-sequence"
            value={sequenceNumber}
            onChange={setSequenceNumber}
            sequenceMax={selectedCollection?.sequenceMax}
            sequenceMin={selectedCollection?.sequenceMin}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        <TagInput value={tags} onChange={setTags} suggestions={allTags?.map((t) => t.name) ?? []} />
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <Label htmlFor="dl-filename-template" className="text-xs uppercase tracking-wide text-muted-foreground">
          Filename Template
        </Label>
        <div className="relative">
          <Input
            id="dl-filename-template"
            placeholder="{artist}/{title}"
            className="pr-8"
            value={filenameTemplate}
            onChange={(e) => setFilenameTemplate(e.target.value)}
          />
          <FilenameTemplateBuilderDialog
            value={filenameTemplate}
            onApply={setFilenameTemplate}
            previewVars={{
              title: previewTitle,
              uploader: preview?.uploader,
              uploadDate: preview?.uploadDate,
              artist: artistName,
              year,
              season: seasonNumber,
              sequence: sequenceNumber,
              collection: collectionName,
            }}
          />
        </div>
        <FilenameCharWarning chars={invalidTemplateChars(filenameTemplate)} />
        <div className="flex flex-wrap gap-1">
          {FILENAME_TEMPLATE_TOKENS.map((token) => (
            <Button
              key={token}
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 font-mono text-xs"
              onClick={() => setFilenameTemplate((v) => v + token)}
            >
              {token}
            </Button>
          ))}
        </div>
        {filenameTemplate.trim() && (
          <p className="truncate text-xs text-muted-foreground">
            Resolves to: <span className="font-mono">{filenameTemplatePreview || "(nothing yet)"}</span>
            {filename.trim() && " — ignored, a literal Filename is set above"}
          </p>
        )}
      </div>
    </>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          New Download
        </Button>
      </DialogTrigger>
      <DialogContent className={cn("sm:max-w-xl", showTwoColumn && "lg:max-w-4xl")}>
        <DialogHeader>
          <DialogTitle>New Download</DialogTitle>
          <DialogDescription>Paste any URL supported by yt-dlp.</DialogDescription>
        </DialogHeader>

        <div className={showTwoColumn ? "grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start" : "space-y-4"}>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
          </div>

          {showPreviewBox && (
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
                  Couldn't fetch a preview for this URL — you can still queue the download.
                </p>
              ) : preview?.isPlaylist ? (
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm font-medium break-words">{preview.playlistTitle || "Playlist"}</p>
                  <p className="text-xs text-muted-foreground">{preview.playlistCount} videos</p>
                </div>
              ) : preview ? (
                <div className="flex items-center gap-3">
                  {preview.thumbnail ? (
                    <img
                      src={preview.thumbnail}
                      alt=""
                      className="h-12 w-20 shrink-0 rounded object-cover bg-muted"
                    />
                  ) : (
                    <div className="h-12 w-20 shrink-0 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 break-words text-sm font-medium">{preview.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {preview.uploader || "Unknown uploader"}
                      {preview.duration > 0 && ` · ${formatDuration(preview.duration)}`}
                      {preview.resolution && ` · ${preview.resolution}`}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {preview?.isPlaylist && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap gap-1 rounded-md border p-0.5">
                {PLAYLIST_MODE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    variant={playlistMode === opt.value ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setPlaylistMode(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>

              {playlistMode === "range" && (
                <div className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="pl-start">Start</Label>
                    <Input
                      id="pl-start"
                      type="number"
                      min="1"
                      placeholder="1"
                      value={playlistStart}
                      onChange={(e) => setPlaylistStart(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="pl-end">End</Label>
                    <Input
                      id="pl-end"
                      type="number"
                      min="1"
                      placeholder={String(preview.playlistCount)}
                      value={playlistEnd}
                      onChange={(e) => setPlaylistEnd(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {playlistMode === "first_n" && (
                <div className="space-y-1">
                  <Label htmlFor="pl-limit">Count</Label>
                  <Input
                    id="pl-limit"
                    type="number"
                    min="1"
                    placeholder="e.g. 10"
                    value={playlistLimit}
                    onChange={(e) => setPlaylistLimit(e.target.value)}
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <Checkbox
                  id="pl-skip-dup"
                  checked={skipDuplicates}
                  onCheckedChange={(v) => setSkipDuplicates(v === true)}
                />
                <Label htmlFor="pl-skip-dup" className="font-normal">
                  Skip items already in the library
                </Label>
              </div>
            </div>
          )}

          {!preview?.isPlaylist && preview?.duplicate && (
            <div className="rounded-md border border-amber-600/50 bg-amber-500/10 p-3 text-sm break-words">
              Already in your library: <span className="font-medium">{preview.duplicate.title}</span>, downloaded{" "}
              {new Date(preview.duplicate.downloadedAt).toLocaleDateString()}.
            </div>
          )}

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

          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <Label>Type</Label>
              <Select value={downloadType} onValueChange={(v) => setDownloadType(v as DownloadType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="audio">Audio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {downloadType === "video" ? (
              <div className="flex-1 space-y-2">
                <Label>Quality</Label>
                <Select value={quality} onValueChange={(v) => setQuality(v as VideoQuality)}>
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
            ) : (
              <div className="flex-1 space-y-2">
                <Label>Format</Label>
                <Select value={audioFormat} onValueChange={(v) => setAudioFormat(v as AudioFormat)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIO_FORMATS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {!preview?.isPlaylist && (
            <div className="space-y-2">
              <Label htmlFor="filename">Filename (optional)</Label>
              {filenameTemplate.trim() ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Input
                      id="filename"
                      placeholder="Disabled — a filename template is set below"
                      value={filename}
                      disabled
                      onChange={(e) => setFilename(e.target.value)}
                    />
                  </TooltipTrigger>
                  <TooltipContent>Clear the filename template in Advanced to set a literal filename instead</TooltipContent>
                </Tooltip>
              ) : (
                <Input
                  id="filename"
                  placeholder="Leave blank to use the video title"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                />
              )}
              <FilenameCharWarning chars={invalidSegmentChars(filename)} />
            </div>
          )}
        </div>

        {showTwoColumn && (
          <div className="space-y-4 lg:border-l lg:pl-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Advanced</h3>
            {advancedFields}
          </div>
        )}
        </div>

        {!showTwoColumn && !preview?.isPlaylist && (
          <div className="space-y-3 border-t pt-3">
            <button
              type="button"
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Advanced
            </button>

            {advancedOpen && <div className="space-y-4">{advancedFields}</div>}
          </div>
        )}

        <DialogFooter>
          {preview?.isPlaylist ? (
            <Button onClick={handleQueuePlaylist} disabled={!url.trim() || createPlaylistDownload.isPending}>
              {createPlaylistDownload.isPending ? "Queuing…" : "Queue Playlist"}
            </Button>
          ) : preview?.duplicate ? (
            <div className="flex w-full flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleSkipDuplicate}>
                Skip
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleReplaceAndDownload}
                disabled={deleteLibraryItem.isPending || createDownload.isPending}
              >
                Replace & Download
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={createDownload.isPending}>
                Download Anyway
              </Button>
            </div>
          ) : (
            <Button onClick={handleSubmit} disabled={!url.trim() || createDownload.isPending}>
              {createDownload.isPending ? "Queuing…" : "Download"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
