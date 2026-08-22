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
import { useCollections } from "@/hooks/useCollections"
import { useDownloadPreview } from "@/hooks/useDownloads"
import { useCreateSubscription } from "@/hooks/useSubscriptions"
import { useTags } from "@/hooks/useTags"
import { sortCollectionsByPath } from "@/lib/collectionTree"
import { TagInput } from "@/components/library/TagInput"

const NO_COLLECTION = "none"
const INTERVAL_OPTIONS = [
  { value: "1", label: "Every hour" },
  { value: "6", label: "Every 6 hours" },
  { value: "12", label: "Every 12 hours" },
  { value: "24", label: "Every day" },
]

interface AddSubscriptionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Saves a channel/playlist URL to be periodically re-checked for new
// uploads (see internal/subscriptions on the backend). The URL preview
// step reuses the exact same metadata-preview machinery the New Download
// and Add Item dialogs use (useDownloadPreview) — the only difference is
// what a "good" result looks like here: a playlist/channel (isPlaylist)
// with more than one entry, not a single video.
export function AddSubscriptionDialog({ open, onOpenChange }: AddSubscriptionDialogProps) {
  const [url, setUrl] = useState("")
  const [debouncedUrl, setDebouncedUrl] = useState("")
  const [mediaType, setMediaType] = useState<"video" | "audio">("video")
  const [collectionId, setCollectionId] = useState(NO_COLLECTION)
  const [tags, setTags] = useState<string[]>([])
  const [autoDownload, setAutoDownload] = useState(false)
  const [generateNfo, setGenerateNfo] = useState(false)
  const [checkIntervalHours, setCheckIntervalHours] = useState("6")

  const { data: collections } = useCollections()
  const { data: allTags } = useTags()
  const createSubscription = useCreateSubscription()

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

  const handleCollectionChange = (value: string) => {
    setCollectionId(value)
    const collection = collections?.find((c) => String(c.id) === value)
    // Subscriptions don't support "image" — a collection defaulted to Image
    // just leaves the current video/audio selection alone.
    if (collection && collection.defaultDownloadType !== "image") setMediaType(collection.defaultDownloadType)
  }

  const reset = () => {
    setUrl("")
    setDebouncedUrl("")
    setMediaType("video")
    setCollectionId(NO_COLLECTION)
    setTags([])
    setAutoDownload(false)
    setGenerateNfo(false)
    setCheckIntervalHours("6")
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleSubmit = () => {
    if (!trimmedUrl) return
    createSubscription.mutate(
      {
        url: trimmedUrl,
        mediaType,
        collectionId: collectionId === NO_COLLECTION ? undefined : Number(collectionId),
        tags: tags.length > 0 ? tags : undefined,
        autoDownload,
        generateNfo,
        checkIntervalHours: Number(checkIntervalHours),
      },
      { onSuccess: () => handleOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add subscription</DialogTitle>
          <DialogDescription>
            Periodically checks this channel or playlist for new uploads — new ones show up as
            placeholders to review, or download automatically if you turn that on below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subscription-url">Channel or playlist URL</Label>
            <Input
              id="subscription-url"
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
                  Couldn't fetch a preview for this URL — you can still add the subscription.
                </p>
              ) : preview?.isPlaylist ? (
                <div>
                  <p className="line-clamp-1 break-words text-sm font-medium">{preview.playlistTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {preview.playlistCount} video{preview.playlistCount === 1 ? "" : "s"} found
                  </p>
                </div>
              ) : preview ? (
                <div className="flex items-center gap-3">
                  {preview.thumbnail ? (
                    <img src={preview.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded bg-muted object-cover" />
                  ) : (
                    <div className="h-12 w-20 shrink-0 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 break-words text-sm font-medium">{preview.title}</p>
                    <p className="text-xs text-muted-foreground">
                      This looks like a single video, not a channel or playlist — still fine to
                      subscribe (e.g. a channel with only one upload so far), but double check the
                      URL if that's not what you meant.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          )}

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

          <div className="space-y-2">
            <Label>Check frequency</Label>
            <Select value={checkIntervalHours} onValueChange={setCheckIntervalHours}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <TagInput value={tags} onChange={setTags} suggestions={allTags?.map((t) => t.name) ?? []} />
          </div>

          <div className="flex items-center gap-1.5">
            <Checkbox id="subscription-auto-download" checked={autoDownload} onCheckedChange={(v) => setAutoDownload(v === true)} />
            <Label htmlFor="subscription-auto-download" className="font-normal">
              Auto-download new items
            </Label>
            <InfoPopover>
              Off (default): new uploads show up as placeholders in the Library for you to review
              and download manually. On: new uploads are queued for download automatically, no
              review step.
            </InfoPopover>
          </div>

          <div className="flex items-center gap-1.5">
            <Checkbox id="subscription-generate-nfo" checked={generateNfo} onCheckedChange={(v) => setGenerateNfo(v === true)} />
            <Label htmlFor="subscription-generate-nfo" className="font-normal">
              Generate NFO for new items
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!trimmedUrl || createSubscription.isPending}>
            {createSubscription.isPending ? "Adding…" : "Add subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
