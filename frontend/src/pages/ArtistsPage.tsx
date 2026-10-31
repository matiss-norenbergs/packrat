import { useEffect, useMemo, useState } from "react"
import { format, parseISO } from "date-fns"
import { ImageIcon, Lock, Pencil, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Skeleton } from "@/components/ui/skeleton"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { RevealAllFloatingAction } from "@/components/library/RevealAllFloatingAction"
import { useRevealAll } from "@/components/library/RevealAllContext"
import { ArtistDialog } from "@/components/artists/ArtistDialog"
import { CollapsiblePanel } from "@/components/CollapsiblePanel"
import { DataTable } from "@/components/data-table"
import type { ColumnDef, ContextMenuItemDef } from "@/components/data-table"
import { useIdSelection } from "@/hooks/useIdSelection"
import { usePersistedOpen } from "@/hooks/usePersistedOpen"
import { useArtistImages, useArtists, useBulkDeleteArtists } from "@/hooks/useArtists"
import { useSettings } from "@/hooks/useSettings"
import { imageUrl } from "@/lib/api"
import { artistRevealKey } from "@/lib/revealKeys"
import { calculateAge, cn } from "@/lib/utils"
import type { Artist } from "@/types/api"

const PAGE_SIZE = 50

const matchArtist = (a: Artist, q: string) => a.name.toLowerCase().includes(q)

export function ArtistsPage() {
  const { data, isLoading, isError, error } = useArtists()
  const selection = useIdSelection()
  const { selected, clear, size, active } = selection
  const [newArtistOpen, setNewArtistOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [panelOpen, setPanelOpen] = usePersistedOpen("packrat:artists-panel-open", true)
  const bulkDeleteArtists = useBulkDeleteArtists()
  const { data: settings } = useSettings()
  const privacyEnabled = !!settings?.privacyEnabled
  const editTarget = size === 1 ? data?.find((a) => selected.has(a.id)) : undefined

  const columns = useMemo<ColumnDef<Artist>[]>(
    () => [
      { key: "name", header: "Name", cell: (a) => a.name, cellClassName: "font-medium", sortValue: (a) => a.name },
      {
        key: "birthday",
        header: "Birthday",
        label: "Birthday",
        hideable: true,
        type: "date",
        cellClassName: "text-muted-foreground",
        sortValue: (a) => (a.birthday ? parseISO(a.birthday) : null),
        cell: (a) =>
          a.birthday ? (
            <>
              {format(parseISO(a.birthday), "MMM d, yyyy")} <span className="text-xs">(age {calculateAge(a.birthday)})</span>
            </>
          ) : (
            "—"
          ),
      },
      {
        key: "usage",
        header: "Usage",
        label: "Usage",
        hideable: true,
        type: "status",
        sortValue: (a) => a.usageCount,
        cell: (a) => (
          <Badge variant="outline">
            {a.usageCount} item{a.usageCount === 1 ? "" : "s"}
          </Badge>
        ),
      },
      ...(privacyEnabled
        ? [
            {
              key: "private",
              header: "Private",
              type: "icon",
              cell: (a) => a.isPrivate && <Lock className="h-3.5 w-3.5 text-primary" aria-label="Private" />,
            } satisfies ColumnDef<Artist>,
          ]
        : []),
    ],
    [privacyEnabled],
  )

  const contextMenu = (rows: Artist[]): ContextMenuItemDef<Artist>[] => [
    { key: "new", label: "New Artist", icon: <Plus className="h-4 w-4" />, onSelect: () => setNewArtistOpen(true) },
    { key: "edit", label: "Edit", icon: <Pencil className="h-4 w-4" />, disabled: rows.length !== 1, onSelect: () => setEditOpen(true) },
    {
      key: "delete",
      label: `Delete${rows.length > 1 ? ` (${rows.length})` : ""}`,
      icon: <Trash2 className="h-4 w-4" />,
      destructive: true,
      disabled: rows.length === 0,
      onSelect: () => setDeleteOpen(true),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <h1 className="shrink-0 text-2xl font-semibold">Artists</h1>
      <RevealAllFloatingAction />

      <div
        className={cn(
          "flex min-h-0 flex-1 transition-[gap] duration-300 ease-in-out",
          panelOpen ? "gap-4 md:gap-6" : "gap-0",
        )}
      >
        <DataTable
          className="overflow-hidden"
          rows={data ?? []}
          getRowId={(a) => a.id}
          columns={columns}
          tableId="artists"
          selection="multi"
          selectionState={selection}
          getRowLabel={(a) => `Select ${a.name}`}
          loading={isLoading}
          error={isError ? <p className="text-sm text-destructive">Failed to load artists: {(error as Error).message}</p> : undefined}
          empty={(query) =>
            !data || data.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No artists yet. Create one to make it available in the Artist picker on library items and downloads.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No artists match "{query}".</p>
            )
          }
          search={{ match: matchArtist, placeholder: "Search artists…" }}
          pageSize={PAGE_SIZE}
          itemLabel={{ singular: "artist", plural: "artists" }}
          contextMenu={contextMenu}
          toolbar={
            <>
              <Button size="sm" onClick={() => setNewArtistOpen(true)}>
                <Plus className="h-4 w-4" />
                New Artist
              </Button>
              <ArtistDialog open={newArtistOpen} onOpenChange={setNewArtistOpen} />

              <Button variant="outline" size="sm" disabled={size !== 1} onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              {editTarget && <ArtistDialog open={editOpen} onOpenChange={setEditOpen} artist={editTarget} />}

              <Button variant="destructive" size="sm" disabled={!active} onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
              <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {size} selected artist{size === 1 ? "" : "s"}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      They'll be cleared from every item that has them.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        bulkDeleteArtists.mutate(
                          { ids: Array.from(selected) },
                          {
                            onSuccess: () => {
                              clear()
                              setDeleteOpen(false)
                            },
                          },
                        )
                      }
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          }
        />

        <CollapsiblePanel
          open={panelOpen}
          onOpenChange={setPanelOpen}
          label="artist images panel"
          widthStorageKey="packrat:artists-panel-width"
        >
          <ArtistImagesPanel artist={editTarget} selectedCount={size} panelOpen={panelOpen} />
        </CollapsiblePanel>
      </div>
    </div>
  )
}

export function ArtistImagesPanel({
  artist,
  selectedCount,
  panelOpen,
}: {
  artist?: Artist
  selectedCount: number
  panelOpen: boolean
}) {
  const { data: images, isLoading } = useArtistImages(artist?.id ?? 0, artist != null && panelOpen)
  const { data: settings } = useSettings()
  const { isRevealed, toggleItem, hideItem } = useRevealAll()

  // One reveal key per artist, shared by every image in the panel. A reveal
  // by click lasts only while this artist stays selected and the panel stays
  // open — the cleanup runs when the selection moves on, empties or
  // multi-selects, and when the panel closes (same as CollectionInfoPanel).
  // Reveal-all is untouched.
  const panelKey = artist && panelOpen ? artistRevealKey(artist.id) : null
  useEffect(() => {
    if (panelKey == null) return
    return () => hideItem(panelKey)
  }, [panelKey, hideItem])

  if (!artist) {
    return (
      <p className="text-sm text-muted-foreground">
        {selectedCount > 1 ? `${selectedCount} artists selected.` : "Select an artist to see its images."}
      </p>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="aspect-square w-full max-w-[300px] rounded-md" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
          <Skeleton className="aspect-square rounded-md" />
          <Skeleton className="aspect-square rounded-md" />
          <Skeleton className="aspect-square rounded-md" />
        </div>
      </div>
    )
  }

  const otherImages = (images ?? []).filter((img) => img.relativePath !== artist.selectedImagePath)
  // The master privacy switch disables every blur even when the artist's own
  // flag is still set underneath.
  const isBlurred = !!settings?.privacyEnabled && artist.isPrivate
  const revealKey = artistRevealKey(artist.id)
  const revealProps = {
    blurred: isBlurred,
    revealed: isRevealed(revealKey),
    onToggleReveal: () => toggleItem(revealKey),
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-2 truncate text-sm font-medium">{artist.name}</h2>
        <div className="aspect-square w-full max-w-[300px] overflow-hidden rounded-md border bg-muted">
          {artist.selectedImagePath ? (
            <BlurredThumbnail
              src={imageUrl(artist.selectedImagePath)}
              className="h-full w-full object-cover"
              {...revealProps}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageIcon className="h-12 w-12 text-muted-foreground/40" />
            </div>
          )}
        </div>
      </div>

      {otherImages.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Other images</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
            {otherImages.map((img) => (
              <div key={img.id} className="aspect-square overflow-hidden rounded-md border">
                <BlurredThumbnail
                  src={imageUrl(img.relativePath)}
                  className="h-full w-full object-cover"
                  {...revealProps}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
