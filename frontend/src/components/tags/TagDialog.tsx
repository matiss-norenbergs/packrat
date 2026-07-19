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
import { useCreateTag, useUpdateTag } from "@/hooks/useTags"
import type { Tag } from "@/types/api"

interface TagDialogProps {
  tag?: Tag
  trigger?: ReactNode
}

export function TagDialog({ tag, trigger }: TagDialogProps) {
  const isEdit = tag != null
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(tag?.name ?? "")
  const [isPrivate, setIsPrivate] = useState(tag?.isPrivate ?? false)

  const createTag = useCreateTag()
  const updateTag = useUpdateTag()
  const pending = createTag.isPending || updateTag.isPending

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName(tag?.name ?? "")
      setIsPrivate(tag?.isPrivate ?? false)
    }
    setOpen(next)
  }

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) return

    if (isEdit) {
      updateTag.mutate({ id: tag.id, payload: { name: trimmed, isPrivate } }, { onSuccess: () => setOpen(false) })
    } else {
      createTag.mutate({ name: trimmed, isPrivate }, { onSuccess: () => setOpen(false) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4" />
            New Tag
          </Button>
        )}
      </DialogTrigger>
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
