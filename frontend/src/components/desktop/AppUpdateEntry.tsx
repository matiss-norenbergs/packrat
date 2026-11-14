import { useState } from "react"
import { AppUpdatePanel } from "@/components/desktop/AppUpdatePanel"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useDesktopAppVersion } from "@/hooks/useDesktopAppVersion"
import { getActiveProfileName, isTauri } from "@/lib/server"

// A quiet "Desktop vX · Check for updates" line for the signed-out screens, opening the shared update
// panel in a dialog — so an app/server mismatch that blocks login can still be fixed from inside the
// app. Renders only in the Tauri shell (the update commands don't exist in a plain browser). It never
// depends on a server: the version text is the app's own, and "Match" appears only when `allowMatch`
// is set and the selected server's version resolves.
export function AppUpdateEntry({ allowMatch = false }: { allowMatch?: boolean }) {
  return isTauri() ? <Entry allowMatch={allowMatch} /> : null
}

function Entry({ allowMatch }: { allowMatch: boolean }) {
  const [open, setOpen] = useState(false)
  const version = useDesktopAppVersion()

  return (
    <>
      <p className="text-center text-xs text-muted-foreground">
        {version && <>Desktop v{version} · </>}
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen(true)}>
          Check for updates
        </Button>
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>App updates</DialogTitle>
            <DialogDescription>{version ? `Packrat Desktop v${version}` : "Packrat Desktop"}</DialogDescription>
          </DialogHeader>
          <AppUpdatePanel allowMatch={allowMatch} serverName={getActiveProfileName()} />
        </DialogContent>
      </Dialog>
    </>
  )
}
