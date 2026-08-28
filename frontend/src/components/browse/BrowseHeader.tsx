import { useEffect, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { LayoutDashboard, Search, X } from "lucide-react"
import { PackratLogo } from "@/components/PackratLogo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// The Browse area's own minimal header — deliberately not Sidebar/MobileNav,
// so Browse never shares chrome with the management area. Search is kept in
// the URL ("q") rather than component state so BrowsePage can read it
// directly, same pattern LibraryToolbar already uses for library search.
export function BrowseHeader() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get("q") ?? ""
  const [searchInput, setSearchInput] = useState(search)
  // Collapsed to just an icon by default — a permanently-open text input
  // eats too much of the header's width on mobile (it was crowding the logo
  // and Manage link together). Starts open if a search is already active
  // (e.g. landing on a URL with ?q= or navigating back to one), and reopens
  // automatically if that ever becomes true later.
  const [expanded, setExpanded] = useState(search.length > 0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (search) setExpanded(true)
  }, [search])

  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

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
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur-sm md:gap-4 md:px-8">
      <Link to="/browse" className="flex shrink-0 items-center gap-2">
        <PackratLogo className="h-5 w-5 shrink-0" />
        {/* Collapses away (mobile only — md: forces it back open) while
            search is expanded, so the input gets the width instead of
            fighting the wordmark for it. max-width + opacity, not
            conditional rendering, so it's an animated collapse rather than
            an instant jump. */}
        <span
          className={
            expanded
              ? "max-w-0 overflow-hidden whitespace-nowrap text-base font-semibold opacity-0 transition-all duration-300 md:max-w-[8rem] md:opacity-100"
              : "max-w-[8rem] overflow-hidden whitespace-nowrap text-base font-semibold opacity-100 transition-all duration-300"
          }
        >
          Packrat
        </span>
      </Link>

      {/* Search and Manage grouped into one right-hand cluster with a
          tighter gap than the header's own — visually paired, but still
          gap-1 (not 0) so the two tap targets stay comfortably distinct on
          mobile. */}
      <div className="ml-auto flex flex-1 items-center justify-end gap-1">
        <div className={expanded ? "flex-1 md:max-w-xs md:flex-none" : ""}>
          {expanded ? (
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                placeholder="Search your library…"
                className="pl-8 pr-7"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onBlur={() => {
                  if (!searchInput) setExpanded(false)
                }}
              />
              {searchInput && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSearchInput("")
                        // Clicking this button moves focus off the input onto
                        // the button itself — without refocusing, a later click
                        // elsewhere blurs the button (which nothing is
                        // listening to), not the input, so the
                        // collapse-when-empty handler below would never fire.
                        inputRef.current?.focus()
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear search</TooltipContent>
                </Tooltip>
              )}
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" onClick={() => setExpanded(true)}>
                  <Search className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Search</TooltipContent>
            </Tooltip>
          )}
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon" className="shrink-0">
              <Link to="/">
                <LayoutDashboard className="h-4 w-4" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Manage</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
