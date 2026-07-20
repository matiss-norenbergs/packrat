import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { LayoutDashboard, Package, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// The Browse area's own minimal header — deliberately not Sidebar/MobileNav,
// so Browse never shares chrome with the management area. Search is kept in
// the URL ("q") rather than component state so BrowsePage can read it
// directly, same pattern LibraryToolbar already uses for library search.
export function BrowseHeader() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get("q") ?? ""
  const [searchInput, setSearchInput] = useState(search)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) {
        const next = new URLSearchParams(searchParams)
        if (searchInput) next.set("q", searchInput)
        else next.delete("q")
        setSearchParams(next, { replace: true })
      }
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b bg-background/95 px-4 py-3 backdrop-blur-sm md:px-8">
      <Link to="/browse" className="flex shrink-0 items-center gap-2">
        <Package className="h-5 w-5" />
        <span className="text-base font-semibold">Packrat</span>
      </Link>

      <div className="relative ml-auto w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search your library…"
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
            onClick={() => setSearchInput("")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <Button asChild variant="ghost" size="sm" className="shrink-0 gap-1.5">
        <Link to="/">
          <LayoutDashboard className="h-4 w-4" />
          Manage
        </Link>
      </Button>
    </header>
  )
}
