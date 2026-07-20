import { Link } from "react-router-dom"
import { Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { mediaFileUrl } from "@/lib/api"
import type { LibraryItem } from "@/types/api"

// The large "featured item" banner at the top of Browse. Callers are
// responsible for picking a non-private item — this component never checks
// item.blurred itself, since a hero has no reveal-to-view affordance the
// way a tile does.
export function BrowseHero({ item }: { item: LibraryItem }) {
  return (
    <div className="relative flex h-[50vh] min-h-72 w-full items-end overflow-hidden md:h-[60vh]">
      {item.thumbnail ? (
        <img
          src={mediaFileUrl(item.thumbnail)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-muted" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />

      <div className="relative space-y-3 p-6 md:p-10">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recently Added</p>
        <h1 className="max-w-xl text-2xl font-bold md:text-4xl">{item.title}</h1>
        <p className="max-w-xl text-sm text-muted-foreground line-clamp-2 md:text-base">
          {item.artistName ?? item.uploader ?? item.collectionName ?? ""}
        </p>
        <Button asChild size="lg" className="gap-2">
          <Link to={`/browse/${item.id}`}>
            <Play className="h-5 w-5" />
            Play
          </Link>
        </Button>
      </div>
    </div>
  )
}
