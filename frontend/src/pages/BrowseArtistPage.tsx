import { Link, useParams } from "react-router-dom"
import { ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { LibraryItemStripTile } from "@/components/library/LibraryItemStripTile"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { useLibrary } from "@/hooks/useLibrary"
import { useArtists } from "@/hooks/useArtists"
import { useSettings } from "@/hooks/useSettings"
import { groupItemsByCollection } from "@/lib/browseShows"
import { imageUrl } from "@/lib/api"

export function BrowseArtistPage() {
  const { id } = useParams<{ id: string }>()
  const artistId = Number(id)

  const { data: items, isLoading: itemsLoading } = useLibrary()
  const { data: artists, isLoading: artistsLoading } = useArtists()
  const { data: settings } = useSettings()
  const ignorePrivacy = settings?.browseIgnorePrivacy ?? false

  if (itemsLoading || artistsLoading || !items || !artists) {
    return (
      <div className="space-y-6 p-4 md:p-8">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-video w-40 shrink-0 rounded-md" />
          ))}
        </div>
      </div>
    )
  }

  const artist = artists.find((a) => a.id === artistId)

  if (!artist) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">This artist doesn't exist (they may have been deleted).</p>
        <Button asChild variant="outline">
          <Link to="/browse">Back to Browse</Link>
        </Button>
      </div>
    )
  }

  const artistItems = items.filter((i) => i.artistId === artist.id)
  const groups = groupItemsByCollection(artistItems)
  const backTo = `/browse/artist/${artist.id}`

  return (
    <RevealAllProvider>
      <div className="space-y-8 px-4 py-8 md:px-8">
        <div className="flex items-center gap-4">
          <div className="h-48 w-48 shrink-0 overflow-hidden rounded-full bg-muted">
            {artist.selectedImagePath ? (
              <img src={imageUrl(artist.selectedImagePath)} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <ImageIcon className="h-14 w-14 text-muted-foreground/40" />
              </div>
            )}
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold md:text-4xl">{artist.name}</h1>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {artistItems.length} {artistItems.length === 1 ? "item" : "items"}
            </p>
          </div>
        </div>

        {groups.map((group) => (
          <section key={group.key} className="space-y-2">
            <h2 className="text-lg font-semibold">{group.label}</h2>
            <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-2">
              {group.items.map((item) => (
                <LibraryItemStripTile
                  key={item.id}
                  item={item}
                  backTo={backTo}
                  basePath="/browse"
                  ignorePrivacy={ignorePrivacy}
                />
              ))}
            </div>
          </section>
        ))}

        {artistItems.length === 0 && <p className="text-sm text-muted-foreground">Nothing assigned to this artist yet.</p>}
      </div>
    </RevealAllProvider>
  )
}
