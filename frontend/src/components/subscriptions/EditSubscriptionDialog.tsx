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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCollections } from "@/hooks/useCollections"
import { useUpdateSubscription } from "@/hooks/useSubscriptions"
import { useTags } from "@/hooks/useTags"
import { sortCollectionsByPath } from "@/lib/collectionTree"
import { TagInput } from "@/components/library/TagInput"
import type { Subscription } from "@/types/api"

const NO_COLLECTION = "none"
const INTERVAL_OPTIONS = [
  { value: "1", label: "Every hour" },
  { value: "6", label: "Every 6 hours" },
  { value: "12", label: "Every 12 hours" },
  { value: "24", label: "Every day" },
]

interface EditSubscriptionDialogProps {
  subscription: Subscription
  open: boolean
  onOpenChange: (open: boolean) => void
}

// URL and Type are fixed at creation (see AddSubscriptionDialog's doc
// comment on why — changing the source is really "delete and re-add").
// Everything else here is editable, buffered until Save like this app's
// other edit dialogs.
export function EditSubscriptionDialog({ subscription, open, onOpenChange }: EditSubscriptionDialogProps) {
  const [collectionId, setCollectionId] = useState(NO_COLLECTION)
  const [tags, setTags] = useState<string[]>([])
  const [autoDownload, setAutoDownload] = useState(false)
  const [generateNfo, setGenerateNfo] = useState(false)
  const [checkIntervalHours, setCheckIntervalHours] = useState("6")
  const [enabled, setEnabled] = useState(true)

  const { data: collections } = useCollections()
  const { data: allTags } = useTags()
  const updateSubscription = useUpdateSubscription()

  useEffect(() => {
    if (!open) return
    setCollectionId(subscription.collectionId != null ? String(subscription.collectionId) : NO_COLLECTION)
    setTags(subscription.tags ?? [])
    setAutoDownload(subscription.autoDownload)
    setGenerateNfo(subscription.generateNfo)
    setCheckIntervalHours(String(subscription.checkIntervalHours))
    setEnabled(subscription.enabled)
  }, [open, subscription])

  const handleSubmit = () => {
    updateSubscription.mutate(
      {
        id: subscription.id,
        payload: {
          collectionId: collectionId === NO_COLLECTION ? undefined : Number(collectionId),
          tags,
          autoDownload,
          generateNfo,
          checkIntervalHours: Number(checkIntervalHours),
          enabled,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="min-w-0">
          <DialogTitle>Edit subscription</DialogTitle>
          <DialogDescription className="min-w-0 truncate">{subscription.url}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-1.5">
            <Checkbox id="edit-subscription-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            <Label htmlFor="edit-subscription-enabled" className="font-normal">
              Enabled
            </Label>
            <InfoPopover>
              Disabling stops the scheduled checks — "Check now" still works manually while
              disabled.
            </InfoPopover>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Collection</Label>
              <Select value={collectionId} onValueChange={setCollectionId}>
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
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <TagInput value={tags} onChange={setTags} suggestions={allTags?.map((t) => t.name) ?? []} />
          </div>

          <div className="flex items-center gap-1.5">
            <Checkbox id="edit-subscription-auto-download" checked={autoDownload} onCheckedChange={(v) => setAutoDownload(v === true)} />
            <Label htmlFor="edit-subscription-auto-download" className="font-normal">
              Auto-download new items
            </Label>
          </div>

          <div className="flex items-center gap-1.5">
            <Checkbox id="edit-subscription-generate-nfo" checked={generateNfo} onCheckedChange={(v) => setGenerateNfo(v === true)} />
            <Label htmlFor="edit-subscription-generate-nfo" className="font-normal">
              Generate NFO for new items
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={updateSubscription.isPending}>
            {updateSubscription.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
