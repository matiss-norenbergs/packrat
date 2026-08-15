import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSettings } from "@/hooks/useSettings"
import { useCreateTag, useUpdateTag } from "@/hooks/useTags"
import type { Tag } from "@/types/api"

interface TagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tag?: Tag
}

// Fully controlled — opened from a toolbar button (New Tag / Edit) rather
// than a per-row trigger, so open state lives in the caller.
export function TagDialog({ open, onOpenChange, tag }: TagDialogProps) {
  const isEdit = tag != null
  const [name, setName] = useState(tag?.name ?? "")
  const [isPrivate, setIsPrivate] = useState(tag?.isPrivate ?? false)

  const { data: settings } = useSettings()
  const createTag = useCreateTag()
  const updateTag = useUpdateTag()
  const pending = createTag.isPending || updateTag.isPending

  // Reset the form fields whenever the dialog opens — the parent flips
  // `open` directly from a toolbar button (not through Dialog's own
  // onOpenChange), so resetting only there would leave stale values from
  // the previous open behind on next open.
  useEffect(() => {
    if (open) {
      setName(tag?.name ?? "")
      setIsPrivate(tag?.isPrivate ?? false)
    }
  }, [open, tag])

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) return

    if (isEdit) {
      updateTag.mutate(
        { id: tag.id, payload: { name: trimmed, isPrivate } },
        { onSuccess: () => onOpenChange(false) },
      )
    } else {
      createTag.mutate({ name: trimmed, isPrivate }, { onSuccess: () => onOpenChange(false) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rename Tag" : "New Tag"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Renaming updates this tag everywhere it's used."
              : "Create a tag now, or just type a new name directly on a library item's Edit dialog."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tag-name">Name</Label>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>

          {settings?.privacyEnabled && (
            <div className="flex items-start gap-2">
              <Checkbox
                id="tag-private"
                checked={isPrivate}
                onCheckedChange={(v) => setIsPrivate(v === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="tag-private" className="font-normal">
                  Private
                </Label>
                <p className="text-xs text-muted-foreground">
                  Blurs thumbnails and hides titles for every item with this tag.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!name.trim() || pending}>
            {pending ? "Saving…" : isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
