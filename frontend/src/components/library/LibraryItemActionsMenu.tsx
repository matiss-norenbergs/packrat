import { useState } from "react"
import { MoreVertical } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { useRedownloadLibraryItem, useRefreshLibraryItemMetadata } from "@/hooks/useLibrary"
import { EditLibraryItemDialog } from "./EditLibraryItemDialog"
import { MoveLibraryItemDialog } from "./MoveLibraryItemDialog"
import { DeleteLibraryItemDialog } from "./DeleteLibraryItemDialog"
import type { LibraryItem } from "@/types/api"

export function LibraryItemActionsMenu({ item }: { item: LibraryItem }) {
  const [editOpen, setEditOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [refreshWarningOpen, setRefreshWarningOpen] = useState(false)

  const refreshMetadata = useRefreshLibraryItemMetadata()
  const redownload = useRedownloadLibraryItem()

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
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit</DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyUrl} disabled={!hasUrl}>
            Copy URL
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMoveOpen(true)}>Move</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRefreshWarningOpen(true)} disabled={!hasUrl}>
            Refresh Metadata
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => redownload.mutate(item.id)} disabled={!hasUrl}>
            Redownload
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditLibraryItemDialog item={item} open={editOpen} onOpenChange={setEditOpen} />
      <MoveLibraryItemDialog item={item} open={moveOpen} onOpenChange={setMoveOpen} />
      <DeleteLibraryItemDialog item={item} open={deleteOpen} onOpenChange={setDeleteOpen} />

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
    </>
  )
}
