import { useEffect } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useLibrary } from "@/hooks/useLibrary"
import { useSettings } from "@/hooks/useSettings"
import { LibraryItemDetail } from "@/components/library/LibraryItemDetail"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { useMiniPlayer } from "@/components/browse/MiniPlayerContext"

// Mirrors LibraryItemPage.tsx exactly, but stays under BrowseLayout's
// chrome instead of AppLayout's — see LibraryItemDetail for the shared
// player/metadata/sibling-strip content itself.
export function BrowseItemPage() {
  const { id } = useParams<{ id: string }>()
  const { data: items, isLoading } = useLibrary()
  const { data: settings } = useSettings()
  const item = items?.find((i) => i.id === Number(id))
  const navigate = useNavigate()
  const location = useLocation()
  const { minimize, close } = useMiniPlayer()
  // Set by MiniPlayerDock's "expand" action so playback resumes at the same
  // position and play/pause state, rather than restarting from 0/autoplaying.
  // "from", when set (a show page's episode strip forwarding its own URL —
  // see LibraryItemStripTile), lets Back return to that show instead of
  // always the top-level Browse page — mirrors LibraryItemPage's own
  // location.state.from handling.
  const navState = location.state as { resumeAt?: number; resumePaused?: boolean; from?: string } | null
  const resumeAt = navState?.resumeAt
  const resumePaused = navState?.resumePaused
  const backTo = navState?.from || "/browse"

  // This page is about to render its own full player for whatever item is
  // being viewed, so any dock still playing something else (or the same
  // item mid-expand) shouldn't keep running alongside it.
  useEffect(() => {
    close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (isLoading) {
    return (
      <div className="p-4 md:p-6">
        <div className="-m-4 h-screen md:-m-6">
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
          <Link to={backTo}>Back to Browse</Link>
        </Button>
      </div>
    )
  }

  // Ghost items have no file to play — Browse's own queries already
  // exclude them, so this page is reachable only via a direct URL; land the
  // same way as the "doesn't exist" case above rather than a player.
  if (item.status === "ghost") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          This item has no downloaded file — use "Download now" from its actions menu on the Library page.
        </p>
        <Button asChild variant="outline">
          <Link to={backTo}>Back to Browse</Link>
        </Button>
      </div>
    )
  }

  return (
    <RevealAllProvider>
      <div className="p-4 md:p-6">
        <LibraryItemDetail
          item={item}
          items={items}
          backTo={backTo}
          basePath="/browse"
          playerHeightClass="h-screen"
          resumeAt={resumeAt}
          resumePaused={resumePaused}
          ignorePrivacy={settings?.browseIgnorePrivacy ?? false}
          onMinimize={(currentTime, paused) => {
            minimize(item, currentTime, paused)
            navigate(backTo)
          }}
        />
      </div>
    </RevealAllProvider>
  )
}
