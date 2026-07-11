import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ArrowDownAZ, ArrowUpAZ, Eye, EyeOff, FolderTree, Info, LayoutGrid, Pencil, Search, Tags, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useCollections } from "@/hooks/useCollections"
import { useLibrary } from "@/hooks/useLibrary"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import { useTags } from "@/hooks/useTags"
import type { LibrarySortDir, LibrarySortKey } from "@/lib/libraryFilters"
import { useRevealAll } from "./RevealAllContext"

const SORT_OPTIONS: { value: LibrarySortKey; label: string }[] = [
  { value: "downloadedAt", label: "Date downloaded" },
  { value: "title", label: "Title" },
  { value: "filename", label: "Filename" },
  { value: "year", label: "Year" },
  { value: "duration", label: "Duration" },
  { value: "sequenceNumber", label: "Sequence #" },
]

const NONE = "none"

export function LibraryToolbar() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: collections } = useCollections()
  const { data: items } = useLibrary()
  const { data: allTags } = useTags()
  // view/sort are DB-backed settings (remembered across reloads and
  // browsers) rather than URL params — q/collection/year stay URL-only
  // since they're per-visit filters, not a "remembered preference," and
  // moving "collection" out of the URL would break the folder view's
  // breadcrumb/browser-back behavior.
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const { revealAll, toggleRevealAll } = useRevealAll()

  const view = settings?.libraryView === "folders" ? "folders" : "grid"
  const mode = (settings?.libraryMode as "manage" | "details") || "manage"
  const hasBlurred = (items ?? []).some((item) => item.blurred)
  const search = searchParams.get("q") ?? ""
  const [searchInput, setSearchInput] = useState(search)
  const sortKey = (settings?.librarySortKey as LibrarySortKey) || "downloadedAt"
  const sortDir: LibrarySortDir = settings?.librarySortDir === "asc" ? "asc" : "desc"
  const collectionId = searchParams.get("collection") ?? NONE
  const year = searchParams.get("year") ?? NONE
  const selectedTags = (searchParams.get("tags") ?? "").split(",").filter(Boolean)

  const years = [...new Set((items ?? []).map((i) => i.year).filter((y): y is number => y != null))].sort((a, b) => b - a)

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value == null || value === NONE || value === "") next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  // Keep the input in sync when "q" changes from outside this component
  // (e.g. browser back/forward) without fighting the debounce below.
  useEffect(() => {
    setSearchInput(search)
  }, [search])

  // Debounce pushing keystrokes into the URL param that actually drives
  // filtering — updating on every keystroke re-filters the whole grid each
  // time, which feels janky while typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) update("q", searchInput || null)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const toggleTag = (name: string) => {
    const next = selectedTags.includes(name) ? selectedTags.filter((t) => t !== name) : [...selectedTags, name]
    update("tags", next.length > 0 ? next.join(",") : null)
  }

  const setView = (next: "grid" | "folders") => {
    updateSettings.mutate({ libraryView: next })
    // Switching modes makes a stale "collection" filter/location ambiguous
    // between the two views' different meanings for that param — clear it.
    const params = new URLSearchParams(searchParams)
    params.delete("collection")
    setSearchParams(params, { replace: true })
  }

  const setMode = (next: "manage" | "details") => updateSettings.mutate({ libraryMode: next })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[140px] flex-1 sm:min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search title, uploader, artist, description…"
          className="pl-8 pr-7"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        {searchInput && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title="Clear search"
            onClick={() => {
              setSearchInput("")
              update("q", null)
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <Select value={sortKey} onValueChange={(v) => updateSettings.mutate({ librarySortKey: v })}>
        <SelectTrigger className="w-[130px] sm:w-[170px]">
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
          <SelectTrigger className="w-[130px] sm:w-[160px]">
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
        <SelectTrigger className="w-[100px] sm:w-[110px]">
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-[110px] justify-start sm:w-[130px]">
            <Tags className="h-4 w-4" />
            {selectedTags.length > 0 ? `Tags (${selectedTags.length})` : "Tags"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {(allTags ?? []).length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No tags yet</p>
          ) : (
            allTags?.map((tag) => (
              <DropdownMenuCheckboxItem
                key={tag.id}
                checked={selectedTags.includes(tag.name)}
                onSelect={(e) => {
                  e.preventDefault()
                  toggleTag(tag.name)
                }}
              >
                {tag.name}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant={revealAll ? "secondary" : "outline"}
        size="icon"
        title={revealAll ? "Hide all private items" : "Reveal all private items"}
        disabled={!hasBlurred}
        onClick={toggleRevealAll}
      >
        {revealAll ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>

      <div className="flex gap-1 rounded-md border p-0.5">
        <Button
          variant={mode === "manage" ? "secondary" : "ghost"}
          size="icon"
          title="Manage mode"
          onClick={() => setMode("manage")}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant={mode === "details" ? "secondary" : "ghost"}
          size="icon"
          title="Details mode"
          onClick={() => setMode("details")}
        >
          <Info className="h-4 w-4" />
        </Button>
      </div>

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
