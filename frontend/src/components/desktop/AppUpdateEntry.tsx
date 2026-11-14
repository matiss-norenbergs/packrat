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
  // True while an update is downloading/installing: closing the dialog would unmount the progress
  // while the install and restart carry on, so it is held open until the install ends or fails.
  const [installing, setInstalling] = useState(false)
  const version = useDesktopAppVersion()

  return (
    <>
      <p className="text-center text-xs text-muted-foreground">
        {version && <>Desktop v{version} · </>}
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen(true)}>
          Check for updates
        </Button>
      </p>
      <Dialog open={open} onOpenChange={(next) => !(installing && !next) && setOpen(next)}>
        <DialogContent
          className="sm:max-w-md"
          showCloseButton={!installing}
          onEscapeKeyDown={(e) => installing && e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>App updates</DialogTitle>
            <DialogDescription>{version ? `Packrat Desktop v${version}` : "Packrat Desktop"}</DialogDescription>
          </DialogHeader>
          <AppUpdatePanel allowMatch={allowMatch} serverName={getActiveProfileName()}
            onInstallingChange={setInstalling}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
