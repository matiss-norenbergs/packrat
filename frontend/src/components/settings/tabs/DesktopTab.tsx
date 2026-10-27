import { useEffect, useState } from "react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { AppWindow, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { isTauri } from "@/lib/server"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAppVersion } from "@/hooks/useSettings"
import { DownloadsSection } from "@/components/settings/DownloadsSection"
import { ServersSection } from "@/components/settings/ServersSection"
import { UpdateProgress } from "@/components/settings/UpdateProgress"
import { useAppUpdate } from "@/hooks/useAppUpdate"
import { useMatchServerVersion } from "@/hooks/useMatchServerVersion"
import { compareSemver, isReleaseVersion } from "@/lib/semver"
import { useCloseToTray } from "@/hooks/useCloseToTray"
import { useStartup, type StartupMode } from "@/hooks/useStartup"
import { SettingRow } from "@/components/settings/SettingRow"

// Only reachable in the desktop app (see the isDesktop() checks where the tab is registered). The
// server list also works under VITE_DESKTOP in a plain browser; everything else needs the shell.
export function DesktopTab() {
  return (
    <div className="max-w-3xl space-y-6 pb-6">
      <ServersSection />
      {isTauri() && <ShellSettings />}
    </div>
  )
}

// Like Theme/Accent these are per-device preferences — the shell stores them itself, not the server.
function ShellSettings() {
  const { enabled: closeToTray, setEnabled: setCloseToTray } = useCloseToTray()
  const { mode: startup, setMode: setStartup } = useStartup()

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AppWindow className="h-4 w-4" />
            Window and startup
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <SettingRow
            label="Close to tray"
            htmlFor="close-to-tray"
            info={
              <>
                When on, the window's close button hides Packrat to the system tray instead of quitting, so it
                keeps running (and can still raise download notifications). Click the tray icon, or choose "Show
                Packrat" from its menu, to bring the window back; choose "Quit" there to exit completely. When
                off, closing the window quits the app.
              </>
            }
          >
            <Switch
              id="close-to-tray"
              checked={closeToTray === true}
              disabled={closeToTray === null}
              onCheckedChange={setCloseToTray}
            />
          </SettingRow>
          <SettingRow
            label="Startup"
            htmlFor="startup"
            info={
              <>
                Whether Packrat starts when you sign in to this computer. "Hidden in the tray" keeps the window
                out of the way and shows only the tray icon; if the system tray isn't available the window is
                shown anyway. Opening the app yourself always shows the window.
              </>
            }
          >
            <Select value={startup ?? ""} disabled={startup === null} onValueChange={(v) => setStartup(v as StartupMode)}>
              <SelectTrigger id="startup" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Don't start at login</SelectItem>
                <SelectItem value="shown">Start at login</SelectItem>
                <SelectItem value="hidden">Start at login, hidden in the tray</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </CardContent>
      </Card>
      <DownloadsSection />
      <UpdatesSection />
    </>
  )
}

// Manual app updates: nothing is contacted until "Check for updates" is pressed, and nothing is
// installed until "Install and restart" is. See useAppUpdate.
function UpdatesSection() {
  const { state, check, install } = useAppUpdate()
  const match = useMatchServerVersion()
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  const serverVersion = useAppVersion().data?.version

  useEffect(() => {
    let cancelled = false
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((version) => !cancelled && setCurrentVersion(version))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const busy =
    state.status === "checking" ||
    state.status === "installing" ||
    match.state.status === "checking" ||
    match.state.status === "installing"
  const canMatch = isReleaseVersion(serverVersion) && !!currentVersion
  const matches = canMatch && compareSemver(serverVersion, currentVersion) === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          Updates
        </CardTitle>
        <CardDescription>
          {currentVersion
            ? `App ${currentVersion}${serverVersion ? ` · Server ${serverVersion}` : ""}`
            : "Checking your version…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">

        {state.status === "available" ? (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p>
              Version <span className="font-medium">{state.version}</span> is available.
            </p>
            {state.notes && <p className="text-muted-foreground">{state.notes}</p>}
            <Button size="sm" onClick={install}>
              Install and restart
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={check} disabled={busy}>
            {state.status === "checking" ? "Checking…" : "Check for updates"}
          </Button>
        )}

        {canMatch &&
          (matches ? (
            <p className="text-sm text-muted-foreground">Matches your server.</p>
          ) : (
            <div className="space-y-1">
              <Button size="sm" variant="outline" onClick={() => match.check(serverVersion)} disabled={busy}>
                {match.state.status === "checking" ? "Checking…" : "Match server version"}
              </Button>
              <p className="text-sm text-muted-foreground">Install v{serverVersion} to match your server.</p>
            </div>
          ))}

        {state.status === "installing" && <UpdateProgress downloaded={state.downloaded} total={state.total} />}
        {match.state.status === "installing" && (
          <UpdateProgress downloaded={match.state.downloaded} total={match.state.total} />
        )}
        {state.status === "upToDate" && <p className="text-sm text-muted-foreground">You're up to date.</p>}
        {state.status === "error" && (
          <p className="text-sm text-destructive">
            {state.during === "check" ? "Couldn't check for updates" : "Couldn't install the update"}: {state.message}
          </p>
        )}
        {match.state.status === "error" && (
          <p className="text-sm text-destructive">
            {match.state.during === "check" ? "Couldn't check for a matching version" : "Couldn't install the update"}:{" "}
            {match.state.message}
          </p>
        )}

        <AlertDialog open={match.state.status === "confirm"} onOpenChange={(open) => !open && match.cancel()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {match.state.status === "confirm" &&
                  (match.state.downgrade ? "Install an older version?" : `Install v${match.state.version}?`)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {match.state.status === "confirm" &&
                  (match.state.downgrade
                    ? `This replaces v${match.state.currentVersion} with the older v${match.state.version}. It matches your server, but older versions may lack features you're used to.`
                    : `This replaces v${match.state.currentVersion} with v${match.state.version} to match your server. Packrat will restart when it's done.`)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={match.install}>Install and restart</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
