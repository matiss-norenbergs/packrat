import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LibraryItemPreviewRow } from "@/components/library/LibraryItemPreviewRow"
import { useLibraryQuery } from "@/hooks/useLibrary"
import { useLinkSubscriptionEntry } from "@/hooks/useSubscriptions"
import { cn } from "@/lib/utils"
import type { SubscriptionEntry } from "@/types/api"

interface LinkLibraryItemDialogProps {
  subscriptionId: number
  // The entry being linked — null closes the dialog. Passed in rather than
  // a plain open boolean so the dialog always has the right title/sourceId
  // on hand without the caller separately tracking "which entry."
  entry: SubscriptionEntry | null
  onOpenChange: (open: boolean) => void
}

// A direct link (this video was actually downloaded through a different
// source/URL than the subscription tracks) has no automatic way to be
// found — this is a plain search-and-pick over the whole library, not
// filtered to "likely matches," since there's no reliable signal to filter
// on in the first place.
export function LinkLibraryItemDialog({ subscriptionId, entry, onOpenChange }: LinkLibraryItemDialogProps) {
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const link = useLinkSubscriptionEntry()

  // Pre-fill the search with the entry's own title as a starting point —
  // titles often differ across sources but are still the best available
  // hint for a manual search.
  useEffect(() => {
    if (entry) {
      setSearchInput(entry.title)
      setSearch(entry.title)
      setSelectedId(null)
    }
  }, [entry])

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(id)
  }, [searchInput])

  const trimmedSearch = search.trim()
  const { data, isLoading } = useLibraryQuery({ q: trimmedSearch, pageSize: 20 }, entry != null && trimmedSearch !== "")

  const handleLink = () => {
    if (!entry || selectedId == null) return
    link.mutate(
      { subscriptionId, sourceId: entry.sourceId, libraryItemId: selectedId },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={entry != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg min-w-0">
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate">Link "{entry?.title || "entry"}" to a library item</DialogTitle>
          <DialogDescription>
            For when this video was actually downloaded through a different source than this
            subscription tracks, so it wasn't found automatically.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Search library…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          autoFocus
        />

        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
          {isLoading ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">Searching…</p>
          ) : trimmedSearch === "" ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">Type to search the library.</p>
          ) : !data || data.items.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">No matches.</p>
          ) : (
            data.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md p-1.5 text-left transition-colors hover:bg-muted",
                  selectedId === item.id && "bg-muted ring-1 ring-primary",
                )}
              >
                <LibraryItemPreviewRow item={item} className="min-w-0 flex-1" />
                {item.status === "ghost" && <span className="shrink-0 text-xs text-muted-foreground">Ghost</span>}
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleLink} disabled={selectedId == null || link.isPending}>
            {link.isPending ? "Linking…" : "Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
