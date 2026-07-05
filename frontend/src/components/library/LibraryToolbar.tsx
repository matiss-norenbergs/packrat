import { useSearchParams } from "react-router-dom"
import { ArrowDownAZ, ArrowUpAZ, FolderTree, LayoutGrid, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollections } from "@/hooks/useCollections"
import { useLibrary } from "@/hooks/useLibrary"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import type { LibrarySortDir, LibrarySortKey } from "@/lib/libraryFilters"

const SORT_OPTIONS: { value: LibrarySortKey; label: string }[] = [
  { value: "downloadedAt", label: "Date downloaded" },
  { value: "title", label: "Title" },
  { value: "filename", label: "Filename" },
  { value: "year", label: "Year" },
  { value: "duration", label: "Duration" },
]

const NONE = "none"

export function LibraryToolbar() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: collections } = useCollections()
  const { data: items } = useLibrary()
  // view/sort are DB-backed settings (remembered across reloads and
  // browsers) rather than URL params — q/collection/year stay URL-only
  // since they're per-visit filters, not a "remembered preference," and
  // moving "collection" out of the URL would break the folder view's
  // breadcrumb/browser-back behavior.
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()

  const view = settings?.libraryView === "folders" ? "folders" : "grid"
  const search = searchParams.get("q") ?? ""
  const sortKey = (settings?.librarySortKey as LibrarySortKey) || "downloadedAt"
  const sortDir: LibrarySortDir = settings?.librarySortDir === "asc" ? "asc" : "desc"
  const collectionId = searchParams.get("collection") ?? NONE
  const year = searchParams.get("year") ?? NONE

  const years = [...new Set((items ?? []).map((i) => i.year).filter((y): y is number => y != null))].sort((a, b) => b - a)

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value == null || value === NONE || value === "") next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  const setView = (next: "grid" | "folders") => {
    updateSettings.mutate({ libraryView: next })
    // Switching modes makes a stale "collection" filter/location ambiguous
    // between the two views' different meanings for that param — clear it.
    const params = new URLSearchParams(searchParams)
    params.delete("collection")
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search title, uploader, artist, description…"
          className="pl-8"
          value={search}
          onChange={(e) => update("q", e.target.value)}
        />
      </div>

      <Select value={sortKey} onValueChange={(v) => updateSettings.mutate({ librarySortKey: v })}>
        <SelectTrigger className="w-[170px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="icon"
        title={sortDir === "asc" ? "Ascending" : "Descending"}
        onClick={() => updateSettings.mutate({ librarySortDir: sortDir === "asc" ? "desc" : "asc" })}
      >
        {sortDir === "asc" ? <ArrowUpAZ className="h-4 w-4" /> : <ArrowDownAZ className="h-4 w-4" />}
      </Button>

      {view === "grid" && (
        <Select value={collectionId} onValueChange={(v) => update("collection", v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Collection" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>All collections</SelectItem>
            {collections?.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={year} onValueChange={(v) => update("year", v)}>
        <SelectTrigger className="w-[110px]">
          <SelectValue placeholder="Year" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>All years</SelectItem>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex gap-1 rounded-md border p-0.5">
        <Button
          variant={view === "grid" ? "secondary" : "ghost"}
          size="icon"
          title="Grid view"
          onClick={() => setView("grid")}
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        <Button
          variant={view === "folders" ? "secondary" : "ghost"}
          size="icon"
          title="Folder view"
          onClick={() => setView("folders")}
        >
          <FolderTree className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
