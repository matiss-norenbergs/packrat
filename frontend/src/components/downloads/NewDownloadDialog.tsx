import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Plus } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useCreateDownload, useDownloadPreview } from "@/hooks/useDownloads"
import { useCollections } from "@/hooks/useCollections"
import { useArtists } from "@/hooks/useArtists"
import { useSettings } from "@/hooks/useSettings"
import { formatDuration } from "@/lib/utils"
import { ArtistSelect, NO_ARTIST } from "@/components/library/ArtistSelect"
import type { AudioFormat, DownloadType, VideoQuality } from "@/types/api"

const VIDEO_QUALITIES: VideoQuality[] = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"]
const AUDIO_FORMATS: AudioFormat[] = ["mp3", "flac", "m4a", "aac", "wav"]
const NO_COLLECTION = "none"

// Joins the included parts with a plain space, then replaces every space in
// the result with the chosen separator — so a multi-word field like an
// artist name gets the separator between its own words too, not just
// between fields. E.g. artist "Matt Iceberg" + season 1 + sequence 1 with
// separator "." -> "Matt.Iceberg.S01E01".
function buildFilenamePrefix(opts: {
  artist: string
  season: string
  sequence: string
  year: string
  includeArtist: boolean
  includeEpisode: boolean
  includeYear: boolean
  separator: string
}): string {
  const parts: string[] = []
  if (opts.includeArtist && opts.artist.trim()) parts.push(opts.artist.trim())
  if (opts.includeEpisode && (opts.season.trim() || opts.sequence.trim())) {
    const s = opts.season.trim() ? `S${opts.season.trim().padStart(2, "0")}` : ""
    const e = opts.sequence.trim() ? `E${opts.sequence.trim().padStart(2, "0")}` : ""
    parts.push(`${s}${e}`)
  }
  if (opts.includeYear && opts.year.trim()) parts.push(opts.year.trim())
  if (parts.length === 0) return ""
  const sep = opts.separator || " "
  return parts.join(" ").split(" ").join(sep)
}

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
  const [includeArtist, setIncludeArtist] = useState(false)
  const [includeEpisode, setIncludeEpisode] = useState(false)
  const [includeYear, setIncludeYear] = useState(false)
  const [separator, setSeparator] = useState(".")

  const { data: collections } = useCollections()
  const { data: artists } = useArtists()
  const { data: settings } = useSettings()
  const createDownload = useCreateDownload()

  const previewEnabled = !settings?.skipDownloadPreview
  const { data: preview, isLoading: previewLoading, isError: previewError } =
    useDownloadPreview(debouncedUrl, previewEnabled)

  useEffect(() => {
    const trimmed = url.trim()
    const looksLikeUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    if (!looksLikeUrl) {
      setDebouncedUrl("")
      return
    }
    const timer = setTimeout(() => setDebouncedUrl(trimmed), 500)
    return () => clearTimeout(timer)
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
    setIncludeArtist(false)
    setIncludeEpisode(false)
    setIncludeYear(false)
    setSeparator(".")
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
    }
  }

  const artistName = artistId === NO_ARTIST ? "" : (artists?.find((a) => String(a.id) === artistId)?.name ?? "")

  const filenamePrefix = buildFilenamePrefix({
    artist: artistName,
    season: seasonNumber,
    sequence: sequenceNumber,
    year,
    includeArtist,
    includeEpisode,
    includeYear,
    separator,
  })
  const previewTitle = titleOverride.trim() || preview?.title

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
        filenamePrefix: filenamePrefix || undefined,
      },
      {
        onSuccess: () => {
          setOpen(false)
          reset()
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          New Download
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Download</DialogTitle>
          <DialogDescription>Paste any URL supported by yt-dlp.</DialogDescription>
        </DialogHeader>

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

          {previewEnabled && debouncedUrl && (
            <div className="rounded-md border p-3">
              {previewLoading ? (
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-20 shrink-0 rounded" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ) : previewError ? (
                <p className="text-xs text-muted-foreground">
                  Couldn't fetch a preview for this URL — you can still queue the download.
                </p>
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
                    <p className="line-clamp-1 text-sm font-medium">{preview.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {preview.uploader || "Unknown uploader"}
                      {preview.duration > 0 && ` · ${formatDuration(preview.duration)}`}
                      {preview.resolution && ` · ${preview.resolution}`}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <div className="space-y-2">
            <Label>Collection</Label>
            <Select value={collectionId} onValueChange={handleCollectionChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COLLECTION}>None</SelectItem>
                {collections?.map((c) => (
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

          <div className="space-y-2">
            <Label htmlFor="filename">Filename (optional)</Label>
            <Input
              id="filename"
              placeholder="Leave blank to use the video title"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
          </div>

          <div className="space-y-3 border-t pt-3">
            <button
              type="button"
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Advanced
            </button>

            {advancedOpen && (
              <div className="space-y-4">
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
                    <Input
                      id="dl-sequence"
                      type="number"
                      min="1"
                      placeholder="e.g. 1"
                      value={sequenceNumber}
                      onChange={(e) => setSequenceNumber(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2 rounded-md border p-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Filename Prefix
                  </Label>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="dl-prefix-artist"
                        checked={includeArtist}
                        onCheckedChange={(v) => setIncludeArtist(v === true)}
                      />
                      <Label htmlFor="dl-prefix-artist" className="font-normal">
                        Artist
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="dl-prefix-episode"
                        checked={includeEpisode}
                        onCheckedChange={(v) => setIncludeEpisode(v === true)}
                      />
                      <Label htmlFor="dl-prefix-episode" className="font-normal">
                        Season/Episode
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="dl-prefix-year"
                        checked={includeYear}
                        onCheckedChange={(v) => setIncludeYear(v === true)}
                      />
                      <Label htmlFor="dl-prefix-year" className="font-normal">
                        Year
                      </Label>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="dl-separator" className="shrink-0 font-normal">
                      Separator
                    </Label>
                    <Input
                      id="dl-separator"
                      className="w-16"
                      value={separator}
                      onChange={(e) => setSeparator(e.target.value)}
                    />
                  </div>
                  {filenamePrefix && (
                    <p className="truncate text-xs text-muted-foreground">
                      Filename: <span className="font-mono">{filenamePrefix} {previewTitle || "(video title)"}</span>
                      {filename.trim() && " — ignored, a literal Filename is set above"}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!url.trim() || createDownload.isPending}>
            {createDownload.isPending ? "Queuing…" : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
