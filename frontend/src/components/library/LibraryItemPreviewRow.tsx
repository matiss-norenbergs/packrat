import { cn } from "@/lib/utils"
import { BlurredItemThumbnail } from "./BlurredItemThumbnail"
import type { LibraryItem } from "@/types/api"

interface LibraryItemPreviewRowProps {
  item: LibraryItem
  className?: string
  thumbnailClassName?: string
}

// Compact thumbnail + title row for the various bulk-action dialogs'
// preview lists (BulkAssignTagsDialog, BulkDeleteLibraryItemsDialog,
// AddToCompareListDialog, BulkEditLibraryItemRow's header). Unlike the main
// Library grid, the title here is never hashed — these are review lists the
// user is already looking at right before confirming an action, so showing
// which file is which matters more than blurring the title too; the
// thumbnail still blurs by default and is click-to-reveal (see
// BlurredItemThumbnail).
export function LibraryItemPreviewRow({ item, className, thumbnailClassName = "h-8 w-14" }: LibraryItemPreviewRowProps) {
  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <BlurredItemThumbnail item={item} className={thumbnailClassName} />
      <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
    </div>
  )
}
