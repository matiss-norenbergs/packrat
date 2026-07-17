import { useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { ArtistDialog } from "@/components/artists/ArtistDialog"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useArtists, useBulkDeleteArtists, useDeleteArtist } from "@/hooks/useArtists"
import type { Artist } from "@/types/api"

export function ArtistsPage() {
  const { data, isLoading, isError, error } = useArtists()
  const { selected, isSelected, toggle, clear, size, active } = useIdSelection()
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const bulkDeleteArtists = useBulkDeleteArtists()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Artists</h1>
        <ArtistDialog />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Failed to load artists: {(error as Error).message}</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No artists yet. Create one to make it available in the Artist picker on library items and downloads.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {active ? `${size} selected` : "Select artists to bulk edit"}
            </span>
            {active && (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!active}>
                  Bulk operations
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-48">
                <DropdownMenuItem onSelect={() => setBulkDeleteOpen(true)}>Delete selected…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
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
                            setBulkDeleteOpen(false)
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
          </div>

          <div className="space-y-2">
            {data.map((artist) => (
              <ArtistRow
                key={artist.id}
                artist={artist}
                selected={isSelected(artist.id)}
                onSelectedChange={() => toggle(artist.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ArtistRow({
  artist,
  selected,
  onSelectedChange,
}: {
  artist: Artist
  selected: boolean
  onSelectedChange: () => void
}) {
  const deleteArtist = useDeleteArtist()

  return (
    <div className="flex items-center gap-2 rounded-md border p-3">
      <Checkbox checked={selected} onCheckedChange={onSelectedChange} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{artist.name}</span>
          <Badge variant="outline">
            {artist.usageCount} item{artist.usageCount === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>

      <div className="flex shrink-0 gap-1">
        <ArtistDialog
          artist={artist}
          trigger={
            <Button variant="ghost" size="icon" title="Rename">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" title="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{artist.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                It will be cleared from {artist.usageCount} item{artist.usageCount === 1 ? "" : "s"}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteArtist.mutate(artist.id)}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
