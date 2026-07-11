import { Pencil, Trash2 } from "lucide-react"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ArtistDialog } from "@/components/artists/ArtistDialog"
import { useArtists, useDeleteArtist } from "@/hooks/useArtists"
import type { Artist } from "@/types/api"

export function ArtistsPage() {
  const { data, isLoading, isError, error } = useArtists()

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
        <div className="space-y-2">
          {data.map((artist) => (
            <ArtistRow key={artist.id} artist={artist} />
          ))}
        </div>
      )}
    </div>
  )
}

function ArtistRow({ artist }: { artist: Artist }) {
  const deleteArtist = useDeleteArtist()

  return (
    <div className="flex items-center gap-2 rounded-md border p-3">
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
