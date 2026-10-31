import { useState } from "react"
import type { ReactNode } from "react"
import {
  ArrowLeftRight,
  BookmarkPlus,
  Camera,
  Copy,
  Download,
  Eye,
  FileImage,
  FilePlus2,
  FileText,
  FileX,
  Film,
  FolderInput,
  GitCompare,
  Images,
  Info,
  Link2,
  Pencil,
  RefreshCw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
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
import type { ContextMenuItemDef } from "@/components/data-table"
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
import { useFeatureEnabled } from "@/hooks/useFeature"
import { useAddToCompareList, useCompareList, useRemoveFromCompareList } from "@/hooks/useCompareList"
import { useSettings } from "@/hooks/useSettings"
import { useSharpenThumbnailItems } from "@/hooks/useThumbnailEnhancement"
import { useSaveThumbnailToGallery } from "@/hooks/useThumbnailGallery"
import { isAudioFilename } from "@/lib/utils"
import { EditLibraryItemDialog } from "./EditLibraryItemDialog"
import { MoveLibraryItemDialog } from "./MoveLibraryItemDialog"
import { DeleteLibraryItemDialog } from "./DeleteLibraryItemDialog"
import { NfoContentDialog } from "./NfoContentDialog"
import { ThumbnailCustomRangeDialog, type ThumbnailPickOptions } from "./ThumbnailCustomRangeDialog"
import { ThumbnailPickerDialog } from "./ThumbnailPickerDialog"
import { ThumbnailGalleryDialog } from "./ThumbnailGalleryDialog"
import { FrameMatchDialog } from "./FrameMatchDialog"
import { CompareMetadataDialog } from "./CompareMetadataDialog"
import { RedownloadFromUrlDialog } from "./RedownloadFromUrlDialog"
import { TrimLibraryItemDialog } from "./TrimLibraryItemDialog"
import type { FrameMatchMode, LibraryItem } from "@/types/api"

/**
 * One library item's actions as plain data: the single place that defines their labels, icons, order, separators, submenus,
 * destructive flags and the ghost / image / audio / feature gating. The "⋮" dropdown (grid cards, folders, the item page)
 * renders it with DropdownMenu items and the list view's right-click menu converts it with `toContextMenuItems`.
 */
export type LibraryItemAction =
  | { key: string; label: string; icon: ReactNode; destructive?: boolean; disabled?: boolean; onSelect: () => void }
  | { key: string; separator: true }
  | { key: string; label: string; icon: ReactNode; items: LibraryItemAction[] }

// Conditional entries are written as `condition && {…}`; this drops the ones whose condition is false.
const compact = (entries: (LibraryItemAction | false)[]): LibraryItemAction[] => entries.filter((a): a is LibraryItemAction => a !== false)

/** The same actions as a DataTable context menu definition (`rows` are ignored: the actions target their own item). */
export function toContextMenuItems<T>(actions: LibraryItemAction[]): ContextMenuItemDef<T>[] {
  return actions.map((a): ContextMenuItemDef<T> => {
    if ("separator" in a) return { key: a.key, separator: true }
    if ("items" in a) return { key: a.key, label: a.label, icon: a.icon, items: toContextMenuItems<T>(a.items) }
    return { key: a.key, label: a.label, icon: a.icon, destructive: a.destructive, disabled: a.disabled, onSelect: a.onSelect }
  })
}

type DialogId =
  | "edit"
  | "compare"
  | "move"
  | "trim"
  | "delete"
  | "refreshWarning"
  | "redownloadWarning"
  | "redownloadFromUrl"
  | "redownloadThumbWarning"
  | "quickGrabWarning"
  | "thumbnailPicker"
  | "thumbnailCustomRange"
  | "thumbnailGallery"
  | "nfoContent"
  | "deleteNfoWarning"
  | "deleteFileWarning"
  | "deleteThumbnailWarning"
  | "sharpenWarning"

/**
 * The actions of library items and the dialogs / mutations they own. `actionsFor(item)` returns that item's action list;
 * running one that opens a dialog first makes the item the dialog's target. `host` holds every dialog and goes anywhere in
 * the tree, independent of whatever menu triggers the actions: pass `fixedItem` to bind it to one item (the "⋮" dropdown of a
 * card mounts one per card), or omit it to mount it once for many items (the list view's right-click menu). In the
 * many-items mode pass `liveItems` (the current page's rows): only the picked item's id is kept and the dialogs resolve
 * it from those rows on every render, so a refetch updates an open dialog; an item that left the page (moved, deleted,
 * another page) keeps the last snapshot, so the dialog does not blank out.
 */
export function useLibraryItemActions(fixedItem?: LibraryItem, liveItems?: readonly LibraryItem[]) {
  const [picked, setPicked] = useState<{ id: number; snapshot: LibraryItem } | null>(null)
  const live = picked && liveItems?.find((i) => i.id === picked.id)
  // Keep the snapshot at the latest live version (state adjusted during render, so the fallback is never older than needed).
  if (picked && live && live !== picked.snapshot) setPicked({ id: picked.id, snapshot: live })
  const item = fixedItem ?? live ?? picked?.snapshot ?? null
  const [dialog, setDialog] = useState<DialogId | null>(null)
  // undefined = use the Settings frame count / pick range; set by the custom
  // dialog for one run of the picker.
  const [thumbnailPickOptions, setThumbnailPickOptions] = useState<ThumbnailPickOptions | undefined>()
  const [deleteFileAlsoThumbnail, setDeleteFileAlsoThumbnail] = useState(false)
  const [frameMatchMode, setFrameMatchMode] = useState<FrameMatchMode | null>(null)

  const { data: settings } = useSettings()
  const refreshMetadata = useRefreshLibraryItemMetadata()
  const redownload = useRedownloadLibraryItem()
  const redownloadThumbnail = useRedownloadLibraryThumbnail()
  const quickGrabThumbnail = useQuickGrabLibraryThumbnail()
  const generateNfo = useGenerateLibraryItemNFO()
  const deleteNfo = useDeleteLibraryItemNFO()
  const deleteFile = useDeleteLibraryItemFile()
  const deleteThumbnail = useDeleteLibraryItemThumbnail()
  const sharpenThumbnail = useSharpenThumbnailItems()
  const saveThumbnailToGallery = useSaveThumbnailToGallery()

  const compareListEnabled = useFeatureEnabled("featureCompareListEnabled")
  const frameMatchingEnabled = useFeatureEnabled("featureFrameMatchingEnabled")
  const { data: compareList } = useCompareList({ enabled: compareListEnabled })
  const addToCompareList = useAddToCompareList()
  const removeFromCompareList = useRemoveFromCompareList()

  const pick = (target: LibraryItem) => setPicked({ id: target.id, snapshot: target })
  const open = (target: LibraryItem, id: DialogId) => {
    pick(target)
    setDialog(id)
  }
  // A dialog's onOpenChange: closing only counts while it is still the open one (a confirm that moves on to another
  // dialog must not close that one).
  const bind = (id: DialogId) => ({
    open: dialog === id,
    onOpenChange: (next: boolean) => setDialog((current) => (next ? id : current === id ? null : current)),
  })

  const actionsFor = (it: LibraryItem): LibraryItemAction[] => {
    const inCompareList = compareList?.some((i) => i.id === it.id) ?? false
    const hasUrl = !!it.originalUrl
    const hasThumbnail = !!(it.thumbnail || it.thumbnailSmallPath || it.thumbnailMediumPath)
    // A ghost item has no downloaded file yet — file-dependent actions (Move,
    // Trim, NFO generation, frame-grab thumbnails) are hidden rather than
    // disabled, since there's nothing to explain via a tooltip; "Redownload"
    // doubles as the "fill this in" action, so it's relabeled instead.
    const isGhost = it.status === "ghost"
    // Video/thumbnail-specific actions (Trim, NFO, frame-grab/frame-match
    // thumbnails, Sharpen) don't apply to a plain downloaded image — same
    // hidden-not-disabled treatment as the ghost gating above.
    const isImage = it.mediaType === "image"
    // Frame-extraction thumbnail actions (Quick Grab, Choose from Video,
    // both frame-match modes) need an actual video stream to pull frames
    // from — an audio file's thumbnail is just album art, so these are
    // hidden the same way as the ghost/image gating above. Redownload from
    // URL, Sharpen, Save/View Gallery, and Delete all still work fine on an
    // audio item's thumbnail, so they stay.
    const isAudio = isAudioFilename(it.filename)
    const frames = !isGhost && !isImage && !isAudio

    const copyUrl = () => {
      if (!it.originalUrl) return
      navigator.clipboard.writeText(it.originalUrl).then(
        () => toast.success("URL copied"),
        () => toast.error("Couldn't copy URL — clipboard access was denied"),
      )
    }
    const toggleCompareList = () => {
      if (inCompareList) removeFromCompareList.mutate(it.id)
      else addToCompareList.mutate({ itemIds: [it.id] })
    }

    const list = compact([
      { key: "edit", label: "Edit", icon: <Pencil />, onSelect: () => open(it, "edit") },
      !isGhost && { key: "move", label: "Move", icon: <FolderInput />, onSelect: () => open(it, "move") },
      !isGhost && !isImage && { key: "trim", label: "Trim…", icon: <Scissors />, onSelect: () => open(it, "trim") },
      compareListEnabled && {
        key: "compare-list",
        label: inCompareList ? "Remove from compare list" : "Add to compare list",
        icon: <GitCompare />,
        disabled: addToCompareList.isPending || removeFromCompareList.isPending,
        onSelect: toggleCompareList,
      },
      { key: "sep-1", separator: true },
      { key: "copy-url", label: "Copy URL", icon: <Copy />, disabled: !hasUrl, onSelect: copyUrl },
      {
        key: "metadata",
        label: "Metadata",
        icon: <Info />,
        items: [
          { key: "metadata-compare", label: "Compare", icon: <ArrowLeftRight />, disabled: !hasUrl, onSelect: () => open(it, "compare") },
          { key: "metadata-refresh", label: "Refresh", icon: <RefreshCw />, disabled: !hasUrl, onSelect: () => open(it, "refreshWarning") },
        ],
      },
      {
        key: "redownload",
        label: "Redownload",
        icon: <Download />,
        items: [
          {
            key: "redownload-current",
            label: isGhost ? "Download now" : "From Current URL",
            icon: <Download />,
            disabled: !hasUrl,
            onSelect: () => open(it, "redownloadWarning"),
          },
          { key: "redownload-other", label: "From Different URL…", icon: <Link2 />, onSelect: () => open(it, "redownloadFromUrl") },
        ],
      },
      { key: "sep-2", separator: true },
      {
        key: "nfo",
        label: "NFO",
        icon: <FileText />,
        items: compact([
          !isGhost &&
            !isImage && { key: "nfo-generate", label: "Generate Now", icon: <FilePlus2 />, disabled: !it.generateNfo, onSelect: () => generateNfo.mutate(it.id) },
          { key: "nfo-view", label: "View Contents", icon: <Eye />, disabled: !it.nfoExists, onSelect: () => open(it, "nfoContent") },
          { key: "nfo-delete", label: "Delete File", icon: <Trash2 />, destructive: true, onSelect: () => open(it, "deleteNfoWarning") },
        ]),
      },
      {
        key: "thumbnail",
        label: "Thumbnail",
        icon: <FileImage />,
        items: compact([
          { key: "thumb-redownload", label: "Redownload from URL", icon: <Download />, disabled: !hasUrl, onSelect: () => open(it, "redownloadThumbWarning") },
          frames && { key: "thumb-quick-grab", label: "Quick Grab", icon: <Camera />, onSelect: () => open(it, "quickGrabWarning") },
          frames && {
            key: "thumb-choose",
            label: "Choose from Video…",
            icon: <Film />,
            onSelect: () => {
              setThumbnailPickOptions(undefined)
              open(it, "thumbnailPicker")
            },
          },
          frames && {
            key: "thumb-custom",
            label: "Choose from Video (custom)…",
            icon: <SlidersHorizontal />,
            onSelect: () => open(it, "thumbnailCustomRange"),
          },
          frameMatchingEnabled &&
            frames && {
              key: "thumb-match-url",
              label: "Match from URL Thumbnail…",
              icon: <Link2 />,
              disabled: !hasUrl,
              onSelect: () => {
                pick(it)
                setFrameMatchMode("url")
              },
            },
          frameMatchingEnabled &&
            frames && {
              key: "thumb-match-current",
              label: "Match from Current Thumbnail…",
              icon: <RefreshCw />,
              disabled: !hasThumbnail,
              onSelect: () => {
                pick(it)
                setFrameMatchMode("current")
              },
            },
          !isGhost &&
            !isImage &&
            !!settings?.thumbnailEnhancementEnabled && {
              key: "thumb-sharpen",
              label: "Sharpen Thumbnail…",
              icon: <Sparkles />,
              disabled: !hasThumbnail,
              onSelect: () => open(it, "sharpenWarning"),
            },
          { key: "thumb-sep-1", separator: true },
          {
            key: "thumb-save-gallery",
            label: "Save in Thumbnail Gallery",
            icon: <BookmarkPlus />,
            disabled: !hasThumbnail,
            onSelect: () => saveThumbnailToGallery.mutate({ id: it.id }),
          },
          { key: "thumb-view-gallery", label: "View Gallery…", icon: <Images />, onSelect: () => open(it, "thumbnailGallery") },
          { key: "thumb-sep-2", separator: true },
          {
            key: "thumb-delete",
            label: "Delete",
            icon: <Trash2 />,
            destructive: true,
            disabled: !hasThumbnail,
            onSelect: () => open(it, "deleteThumbnailWarning"),
          },
        ]),
      },
      { key: "sep-3", separator: true },
      !isGhost && { key: "delete-file", label: "Delete file…", icon: <FileX />, destructive: true, onSelect: () => open(it, "deleteFileWarning") },
      { key: "delete", label: "Delete", icon: <Trash2 />, destructive: true, onSelect: () => open(it, "delete") },
    ])
    return list
  }

  const host = item && (
    <>
      <EditLibraryItemDialog item={item} {...bind("edit")} />
      <CompareMetadataDialog item={item} {...bind("compare")} />
      <RedownloadFromUrlDialog item={item} {...bind("redownloadFromUrl")} />
      <MoveLibraryItemDialog item={item} {...bind("move")} />
      <TrimLibraryItemDialog item={item} {...bind("trim")} />
      <DeleteLibraryItemDialog item={item} {...bind("delete")} />
      <ThumbnailCustomRangeDialog
        {...bind("thumbnailCustomRange")}
        durationSeconds={item.duration}
        onConfirm={(options) => {
          setThumbnailPickOptions(options)
          setDialog("thumbnailPicker")
        }}
      />
      <ThumbnailPickerDialog item={item} {...bind("thumbnailPicker")} options={thumbnailPickOptions} />
      <ThumbnailGalleryDialog item={item} {...bind("thumbnailGallery")} />
      <NfoContentDialog item={item} {...bind("nfoContent")} />
      {frameMatchingEnabled && frameMatchMode && (
        <FrameMatchDialog
          item={item}
          mode={frameMatchMode}
          open={frameMatchMode != null}
          onOpenChange={(open) => !open && setFrameMatchMode(null)}
        />
      )}

      <AlertDialog {...bind("refreshWarning")}>
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

      <AlertDialog {...bind("redownloadWarning")}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{item.status === "ghost" ? "Download this item's file?" : "Redownload this file?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {item.status === "ghost"
                ? "This fetches the file from the item's source URL for the first time. Resolution and duration get filled in — title, tags, season/sequence, year, and artist are left exactly as they are."
                : "This re-fetches the file from its original URL and replaces it. Only resolution and duration are updated here — title, tags, season/sequence, year, artist, and thumbnail are left exactly as they are."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => redownload.mutate(item.id)}>
              {item.status === "ghost" ? "Download" : "Redownload"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog {...bind("redownloadThumbWarning")}>
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

      <AlertDialog {...bind("quickGrabWarning")}>
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

      <AlertDialog {...bind("sharpenWarning")}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sharpen this item's thumbnail?</AlertDialogTitle>
            <AlertDialogDescription>
              Runs the current thumbnail through your configured Stable Diffusion WebUI instance for
              a denoise/detail pass only — the output stays the same size, it's not upscaled. This
              runs in the background; check the AI Enhancement page for progress.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => sharpenThumbnail.mutate([item.id])}>Sharpen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog {...bind("deleteThumbnailWarning")}>
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

      <AlertDialog {...bind("deleteNfoWarning")}>
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
        open={dialog === "deleteFileWarning"}
        onOpenChange={(next) => {
          bind("deleteFileWarning").onOpenChange(next)
          if (!next) setDeleteFileAlsoThumbnail(false)
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

  return { actionsFor, host }
}
