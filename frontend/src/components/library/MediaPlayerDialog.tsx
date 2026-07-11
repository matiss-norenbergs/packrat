import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { mediaFileUrl } from "@/lib/api"
import { isAudioFilename } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"

interface MediaPlayerDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MediaPlayerDialog({ item, open, onOpenChange }: MediaPlayerDialogProps) {
  const audio = isAudioFilename(item.filename)
  const src = mediaFileUrl(item.path)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={audio ? "sm:max-w-md" : "sm:max-w-3xl"}>
        <DialogHeader>
          <DialogTitle className="line-clamp-2 pr-6">{item.title}</DialogTitle>
        </DialogHeader>

        {audio ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{item.artist ?? item.uploader ?? "Unknown artist"}</p>
            <audio key={src} controls autoPlay className="w-full">
              <source src={src} />
            </audio>
          </div>
        ) : (
          <video key={src} controls autoPlay className="w-full rounded-md bg-black">
            <source src={src} />
          </video>
        )}
      </DialogContent>
    </Dialog>
  )
}
