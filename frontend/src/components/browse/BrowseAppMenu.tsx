import { useRef, useState, useSyncExternalStore } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { ChevronLeft, ChevronRight, LogOut, Menu, Server, Settings } from "lucide-react"
import { BrowseSettingsDialog } from "@/components/browse/BrowseSettingsDialog"
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
// "Settings" opens BrowseSettingsDialog (this device's playback/privacy preferences).
export function BrowseAppMenu() {
  const logout = useLogout()
  const serverName = useSyncExternalStore(subscribeProfiles, getActiveProfileName)
  const [view, setView] = useState<"main" | "servers">("main")
  const settings = useSettingsDialogHistory()

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && setView("main")}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 pointer-coarse:size-11"
            aria-label="App menu"
          >
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
                <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                  {serverName}
                </DropdownMenuLabel>
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
              <DropdownMenuItem className={ITEM} onSelect={settings.open}>
                <Settings className="h-4 w-4" />
                Settings
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
      <BrowseSettingsDialog open={settings.isOpen} onClose={settings.close} />
    </>
  )
}

type DialogState = { browseSettings?: boolean } & Record<string, unknown>

// The Settings dialog's open state lives in the history entry (location.state.browseSettings), not
// in component state, so Android's Back gesture — which walks the WebView history (see
// docs/architecture.md → "Back gesture on Android") — closes the dialog instead of leaving the page.
// Opening pushes an entry for the same URL (keeping the page's own state, e.g. an item page's
// "from"); Back pops it. Closing with the X (or Escape) pops that same entry, so no extra entry is
// left behind. An entry this menu didn't push (the page was reloaded with the dialog open) is
// replaced with a copy without the flag instead, since there may be nothing to go back to.
function useSettingsDialogHistory() {
  const location = useLocation()
  const navigate = useNavigate()
  const pushed = useRef(false)
  const state = (location.state ?? null) as DialogState | null
  const to = location.pathname + location.search + location.hash

  return {
    isOpen: state?.browseSettings === true,
    open: () => {
      pushed.current = true
      navigate(to, { state: { ...state, browseSettings: true } })
    },
    close: () => {
      if (state?.browseSettings !== true) return
      if (pushed.current) {
        pushed.current = false
        navigate(-1)
        return
      }
      const rest: DialogState = { ...state }
      delete rest.browseSettings
      navigate(to, {
        replace: true,
        state: Object.keys(rest).length ? rest : null,
      })
    },
  }
}
