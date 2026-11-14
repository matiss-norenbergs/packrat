import { AppWindow, RefreshCw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { isTauri } from "@/lib/server"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAppVersion } from "@/hooks/useSettings"
import { DownloadsSection } from "@/components/settings/DownloadsSection"
import { ServersSection } from "@/components/settings/ServersSection"
import { AppUpdatePanel } from "@/components/desktop/AppUpdatePanel"
import { useDesktopAppVersion } from "@/hooks/useDesktopAppVersion"
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

// The update UI is shared with the login screen (AppUpdateEntry); see AppUpdatePanel.
function UpdatesSection() {
  const currentVersion = useDesktopAppVersion()
  const serverVersion = useAppVersion().data?.version

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
      <CardContent>
        <AppUpdatePanel />
      </CardContent>
    </Card>
  )
}
