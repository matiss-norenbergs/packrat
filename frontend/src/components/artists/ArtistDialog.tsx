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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCreateArtist, useUpdateArtist } from "@/hooks/useArtists"
import type { Artist } from "@/types/api"

interface ArtistDialogProps {
  artist?: Artist
  trigger?: ReactNode
}

export function ArtistDialog({ artist, trigger }: ArtistDialogProps) {
  const isEdit = artist != null
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(artist?.name ?? "")

  const createArtist = useCreateArtist()
  const updateArtist = useUpdateArtist()
  const pending = createArtist.isPending || updateArtist.isPending

  const handleOpenChange = (next: boolean) => {
    if (next) setName(artist?.name ?? "")
    setOpen(next)
  }

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) return

    if (isEdit) {
      updateArtist.mutate({ id: artist.id, payload: { name: trimmed } }, { onSuccess: () => setOpen(false) })
    } else {
      createArtist.mutate({ name: trimmed }, { onSuccess: () => setOpen(false) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4" />
            New Artist
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rename Artist" : "New Artist"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Renaming updates this artist everywhere it's used."
              : "Create an artist to make it available in the Artist picker on library items and downloads."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="artist-name">Name</Label>
          <Input
            id="artist-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
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
