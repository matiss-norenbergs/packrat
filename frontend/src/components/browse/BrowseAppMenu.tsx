import { useState, useSyncExternalStore } from "react"
import { ChevronLeft, ChevronRight, LogOut, Menu, Server } from "lucide-react"
import { ServerSwitcherItems } from "@/components/ServerSwitcher"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLogout } from "@/hooks/useAuth"
import { getActiveProfileName, subscribeProfiles } from "@/lib/server"

// Touch-sized rows (the default menu rows are ~28px tall).
const ITEM = "gap-2 pointer-coarse:py-2.5"

// The Android app's only chrome besides the logo and search (Browse-only mode, see lib/appMode.ts):
// the current server, "Change server" (the desktop app's server switcher entries — saved servers,
// "Add server…" — without "Manage servers", since Settings isn't part of the app) and "Sign out"
// (the sidebar's log-out action). "Change server" swaps the menu's content for the server list in
// place (with a Back row) rather than opening a side sub-menu, which has no room on a phone.
export function BrowseAppMenu() {
  const logout = useLogout()
  const serverName = useSyncExternalStore(subscribeProfiles, getActiveProfileName)
  const [view, setView] = useState<"main" | "servers">("main")

  return (
    <DropdownMenu onOpenChange={(open) => open && setView("main")}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="shrink-0 pointer-coarse:size-11" aria-label="App menu">
          <Menu className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 max-w-[calc(100vw-2rem)]">
        {view === "servers" ? (
          <>
            <DropdownMenuItem
              className={ITEM}
              onSelect={(e) => {
                e.preventDefault() // stay open, back to the main entries
                setView("main")
              }}
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <ServerSwitcherItems />
          </>
        ) : (
          <>
            {serverName && (
              <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{serverName}</DropdownMenuLabel>
            )}
            <DropdownMenuItem
              className={ITEM}
              onSelect={(e) => {
                e.preventDefault() // stay open, showing the servers
                setView("servers")
              }}
            >
              <Server className="h-4 w-4" />
              Change server
              <ChevronRight className="ml-auto h-4 w-4" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={ITEM} disabled={logout.isPending} onSelect={() => logout.mutate()}>
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
