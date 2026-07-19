import { useState } from "react"
import { MoreVertical } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  useDeleteLibraryItemNFO,
  useGenerateLibraryItemNFO,
  useQuickGrabLibraryThumbnail,
  useRedownloadLibraryItem,
  useRedownloadLibraryThumbnail,
  useRefreshLibraryItemMetadata,
} from "@/hooks/useLibrary"
import { EditLibraryItemDialog } from "./EditLibraryItemDialog"
import { MoveLibraryItemDialog } from "./MoveLibraryItemDialog"
import { DeleteLibraryItemDialog } from "./DeleteLibraryItemDialog"
import { NfoContentDialog } from "./NfoContentDialog"
import { ThumbnailPickerDialog } from "./ThumbnailPickerDialog"
import { CompareMetadataDialog } from "./CompareMetadataDialog"
import type { LibraryItem } from "@/types/api"

export function LibraryItemActionsMenu({ item }: { item: LibraryItem }) {
  const [editOpen, setEditOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [refreshWarningOpen, setRefreshWarningOpen] = useState(false)
  const [redownloadThumbWarningOpen, setRedownloadThumbWarningOpen] = useState(false)
  const [quickGrabWarningOpen, setQuickGrabWarningOpen] = useState(false)
  const [thumbnailPickerOpen, setThumbnailPickerOpen] = useState(false)
  const [nfoContentOpen, setNfoContentOpen] = useState(false)
  const [deleteNfoWarningOpen, setDeleteNfoWarningOpen] = useState(false)

  const refreshMetadata = useRefreshLibraryItemMetadata()
  const redownload = useRedownloadLibraryItem()
  const redownloadThumbnail = useRedownloadLibraryThumbnail()
  const quickGrabThumbnail = useQuickGrabLibraryThumbnail()
  const generateNfo = useGenerateLibraryItemNFO()
  const deleteNfo = useDeleteLibraryItemNFO()

  const hasUrl = !!item.originalUrl

  const handleCopyUrl = () => {
    if (!item.originalUrl) return
    navigator.clipboard.writeText(item.originalUrl).then(
      () => toast.success("URL copied"),
      () => toast.error("Couldn't copy URL — clipboard access was denied"),
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMoveOpen(true)}>Move</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyUrl} disabled={!hasUrl}>
            Copy URL
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setCompareOpen(true)} disabled={!hasUrl}>
            Compare Metadata
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRefreshWarningOpen(true)} disabled={!hasUrl}>
            Refresh Metadata
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => redownload.mutate(item.id)} disabled={!hasUrl}>
            Redownload
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>NFO</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => generateNfo.mutate(item.id)} disabled={!item.generateNfo}>
                Generate Now
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNfoContentOpen(true)} disabled={!item.nfoExists}>
                View Contents
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteNfoWarningOpen(true)}>
                Delete File
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Thumbnail</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => setRedownloadThumbWarningOpen(true)} disabled={!hasUrl}>
                Redownload from URL
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setQuickGrabWarningOpen(true)}>Quick Grab</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setThumbnailPickerOpen(true)}>Choose from Video…</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditLibraryItemDialog item={item} open={editOpen} onOpenChange={setEditOpen} />
      <CompareMetadataDialog item={item} open={compareOpen} onOpenChange={setCompareOpen} />
      <MoveLibraryItemDialog item={item} open={moveOpen} onOpenChange={setMoveOpen} />
      <DeleteLibraryItemDialog item={item} open={deleteOpen} onOpenChange={setDeleteOpen} />
      <ThumbnailPickerDialog item={item} open={thumbnailPickerOpen} onOpenChange={setThumbnailPickerOpen} />
      <NfoContentDialog item={item} open={nfoContentOpen} onOpenChange={setNfoContentOpen} />

      <AlertDialog open={refreshWarningOpen} onOpenChange={setRefreshWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refresh metadata from source?</AlertDialogTitle>
            <AlertDialogDescription>
              This re-fetches title, uploader, duration, resolution, and description from the
              original URL — overwriting any manual edits you've made here. The media file and
              thumbnail are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => refreshMetadata.mutate(item.id)}>Refresh</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={redownloadThumbWarningOpen} onOpenChange={setRedownloadThumbWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redownload thumbnail?</AlertDialogTitle>
            <AlertDialogDescription>
              This re-fetches the thumbnail image from the original URL, replacing the current one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => redownloadThumbnail.mutate(item.id)}>Redownload</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={quickGrabWarningOpen} onOpenChange={setQuickGrabWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Grab a random frame as thumbnail?</AlertDialogTitle>
            <AlertDialogDescription>
              This grabs a random frame from the video file itself, replacing the current
              thumbnail. If you'd rather pick from a few options, use "Choose from Video" instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => quickGrabThumbnail.mutate(item.id)}>Grab</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteNfoWarningOpen} onOpenChange={setDeleteNfoWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the .nfo file?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the .nfo file from disk. If "Generate NFO" is still enabled for this
              item, it reappears the next time you save a relevant edit — to stop that too, turn
              off "Generate NFO" in Edit instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteNfo.mutate(item.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
