import { useState } from "react"
import { MoreVertical } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
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
  useDeleteLibraryItemFile,
  useDeleteLibraryItemNFO,
  useDeleteLibraryItemThumbnail,
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
import { FrameMatchDialog } from "./FrameMatchDialog"
import { CompareMetadataDialog } from "./CompareMetadataDialog"
import { RedownloadFromUrlDialog } from "./RedownloadFromUrlDialog"
import { TrimLibraryItemDialog } from "./TrimLibraryItemDialog"
import type { FrameMatchMode, LibraryItem } from "@/types/api"

export function LibraryItemActionsMenu({ item }: { item: LibraryItem }) {
  const [editOpen, setEditOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [trimOpen, setTrimOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [refreshWarningOpen, setRefreshWarningOpen] = useState(false)
  const [redownloadWarningOpen, setRedownloadWarningOpen] = useState(false)
  const [redownloadFromUrlOpen, setRedownloadFromUrlOpen] = useState(false)
  const [redownloadThumbWarningOpen, setRedownloadThumbWarningOpen] = useState(false)
  const [quickGrabWarningOpen, setQuickGrabWarningOpen] = useState(false)
  const [thumbnailPickerOpen, setThumbnailPickerOpen] = useState(false)
  const [nfoContentOpen, setNfoContentOpen] = useState(false)
  const [deleteNfoWarningOpen, setDeleteNfoWarningOpen] = useState(false)
  const [deleteFileWarningOpen, setDeleteFileWarningOpen] = useState(false)
  const [deleteFileAlsoThumbnail, setDeleteFileAlsoThumbnail] = useState(false)
  const [deleteThumbnailWarningOpen, setDeleteThumbnailWarningOpen] = useState(false)
  const [frameMatchMode, setFrameMatchMode] = useState<FrameMatchMode | null>(null)

  const refreshMetadata = useRefreshLibraryItemMetadata()
  const redownload = useRedownloadLibraryItem()
  const redownloadThumbnail = useRedownloadLibraryThumbnail()
  const quickGrabThumbnail = useQuickGrabLibraryThumbnail()
  const generateNfo = useGenerateLibraryItemNFO()
  const deleteNfo = useDeleteLibraryItemNFO()
  const deleteFile = useDeleteLibraryItemFile()
  const deleteThumbnail = useDeleteLibraryItemThumbnail()

  const hasUrl = !!item.originalUrl
  const hasThumbnail = !!(item.thumbnail || item.thumbnailSmallPath || item.thumbnailMediumPath)
  // A ghost item has no downloaded file yet — file-dependent actions (Move,
  // Trim, NFO generation, frame-grab thumbnails) are hidden rather than
  // disabled, since there's nothing to explain via a tooltip; "Redownload"
  // doubles as the "fill this in" action, so it's relabeled instead.
  const isGhost = item.status === "ghost"

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
          {!isGhost && <DropdownMenuItem onClick={() => setMoveOpen(true)}>Move</DropdownMenuItem>}
          {!isGhost && <DropdownMenuItem onClick={() => setTrimOpen(true)}>Trim…</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyUrl} disabled={!hasUrl}>
            Copy URL
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Metadata</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => setCompareOpen(true)} disabled={!hasUrl}>
                Compare
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRefreshWarningOpen(true)} disabled={!hasUrl}>
                Refresh
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Redownload</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => setRedownloadWarningOpen(true)} disabled={!hasUrl}>
                {isGhost ? "Download now" : "From Current URL"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRedownloadFromUrlOpen(true)}>From Different URL…</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>NFO</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {!isGhost && (
                <DropdownMenuItem onClick={() => generateNfo.mutate(item.id)} disabled={!item.generateNfo}>
                  Generate Now
                </DropdownMenuItem>
              )}
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
              {!isGhost && (
                <DropdownMenuItem onClick={() => setQuickGrabWarningOpen(true)}>Quick Grab</DropdownMenuItem>
              )}
              {!isGhost && (
                <DropdownMenuItem onClick={() => setThumbnailPickerOpen(true)}>Choose from Video…</DropdownMenuItem>
              )}
              {!isGhost && (
                <DropdownMenuItem onClick={() => setFrameMatchMode("url")} disabled={!hasUrl}>
                  Match from URL Thumbnail…
                </DropdownMenuItem>
              )}
              {!isGhost && (
                <DropdownMenuItem onClick={() => setFrameMatchMode("current")} disabled={!hasThumbnail}>
                  Match from Current Thumbnail…
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={!hasThumbnail}
                onClick={() => setDeleteThumbnailWarningOpen(true)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          {!isGhost && (
            <DropdownMenuItem variant="destructive" onClick={() => setDeleteFileWarningOpen(true)}>
              Delete file…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditLibraryItemDialog item={item} open={editOpen} onOpenChange={setEditOpen} />
      <CompareMetadataDialog item={item} open={compareOpen} onOpenChange={setCompareOpen} />
      <RedownloadFromUrlDialog item={item} open={redownloadFromUrlOpen} onOpenChange={setRedownloadFromUrlOpen} />
      <MoveLibraryItemDialog item={item} open={moveOpen} onOpenChange={setMoveOpen} />
      <TrimLibraryItemDialog item={item} open={trimOpen} onOpenChange={setTrimOpen} />
      <DeleteLibraryItemDialog item={item} open={deleteOpen} onOpenChange={setDeleteOpen} />
      <ThumbnailPickerDialog item={item} open={thumbnailPickerOpen} onOpenChange={setThumbnailPickerOpen} />
      <NfoContentDialog item={item} open={nfoContentOpen} onOpenChange={setNfoContentOpen} />
      {frameMatchMode && (
        <FrameMatchDialog
          item={item}
          mode={frameMatchMode}
          open={frameMatchMode != null}
          onOpenChange={(open) => !open && setFrameMatchMode(null)}
        />
      )}

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

      <AlertDialog open={redownloadWarningOpen} onOpenChange={setRedownloadWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isGhost ? "Download this item's file?" : "Redownload this file?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isGhost
                ? "This fetches the file from the item's source URL for the first time. Resolution and duration get filled in — title, tags, season/sequence, year, and artist are left exactly as they are."
                : "This re-fetches the file from its original URL and replaces it. Only resolution and duration are updated here — title, tags, season/sequence, year, artist, and thumbnail are left exactly as they are."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => redownload.mutate(item.id)}>
              {isGhost ? "Download" : "Redownload"}
            </AlertDialogAction>
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

      <AlertDialog open={deleteThumbnailWarningOpen} onOpenChange={setDeleteThumbnailWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item's thumbnail?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the thumbnail image from disk. The media file and everything else about
              this item are untouched — it shows a placeholder icon until a new thumbnail is set.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteThumbnail.mutate(item.id)}>Delete</AlertDialogAction>
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

      <AlertDialog
        open={deleteFileWarningOpen}
        onOpenChange={(open) => {
          setDeleteFileWarningOpen(open)
          if (!open) setDeleteFileAlsoThumbnail(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item's file?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the media file from disk to reclaim space. The library entry, tags,
              collection membership, and all other metadata stay — the item shows a placeholder
              until you download it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="delete-file-also-thumbnail"
              checked={deleteFileAlsoThumbnail}
              onCheckedChange={(v) => setDeleteFileAlsoThumbnail(v === true)}
            />
            <Label htmlFor="delete-file-also-thumbnail" className="font-normal">
              Also delete thumbnail
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteFile.mutate({ id: item.id, deleteThumbnail: deleteFileAlsoThumbnail })}
            >
              Delete file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
