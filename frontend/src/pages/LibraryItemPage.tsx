import { Link, useLocation, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useLibrary } from "@/hooks/useLibrary"
import { LibraryItemDetail } from "@/components/library/LibraryItemDetail"
import { RevealAllProvider } from "@/components/library/RevealAllContext"

export function LibraryItemPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  // Only ever set by an in-app Link/navigate (LibraryCard's Play button, or
  // a sibling tile forwarding its own backTo) — a direct URL load never
  // carries router state, so this correctly falls back to the plain
  // library page in that case.
  const backTo = (location.state as { from?: string } | null)?.from || "/library"
  const { data: items, isLoading } = useLibrary()
  const item = items?.find((i) => i.id === Number(id))

  if (isLoading) {
    return (
      <div>
        <div className="-m-4 h-[calc(100vh-3.5rem)] md:-m-6 md:h-screen">
          <Skeleton className="h-full w-full rounded-none" />
        </div>
        <div className="space-y-2 pt-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
    )
  }

  if (!items || !item) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">This library item doesn't exist (it may have been deleted).</p>
        <Button asChild variant="outline">
          <Link to={backTo}>Back to Library</Link>
        </Button>
      </div>
    )
  }

  return (
    <RevealAllProvider>
      <LibraryItemDetail
        item={item}
        items={items}
        backTo={backTo}
        basePath="/library"
        playerHeightClass="h-[calc(100vh-3.5rem)] md:h-screen"
      />
    </RevealAllProvider>
  )
}
