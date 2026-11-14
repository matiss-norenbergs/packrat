import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { UpdateProgress } from "@/components/settings/UpdateProgress"
import { useAppUpdate } from "@/hooks/useAppUpdate"
import { useAppVersion } from "@/hooks/useSettings"
import { useDesktopAppVersion } from "@/hooks/useDesktopAppVersion"
import { useMatchServerVersion } from "@/hooks/useMatchServerVersion"
import { compareSemver, isReleaseVersion } from "@/lib/semver"

interface AppUpdatePanelProps {
  // Offer "Match server version" (needs a server whose version resolves). On by default.
  allowMatch?: boolean
  // Name of the selected server profile. When given (the signed-out screens), the match button and
  // hints name it; Settings leaves it out and keeps the generic "your server" wording.
  serverName?: string | null
}

// Manual app updates: nothing is contacted until "Check for updates" is pressed, and nothing is
// installed until "Install and restart" is. See useAppUpdate. Needs no signed-in session, so it is
// shared by Settings → Desktop and the login screen's update dialog.
export function AppUpdatePanel({ allowMatch = true, serverName }: AppUpdatePanelProps) {
  const { state, check, install } = useAppUpdate()
  const match = useMatchServerVersion()
  const currentVersion = useDesktopAppVersion()
  const serverVersion = useAppVersion({ enabled: allowMatch }).data?.version

  const busy =
    state.status === "checking" ||
    state.status === "installing" ||
    match.state.status === "checking" ||
    match.state.status === "installing"
  const canMatch = allowMatch && isReleaseVersion(serverVersion) && !!currentVersion
  const matches = canMatch && compareSemver(serverVersion, currentVersion) === 0
  const target = serverName ?? "your server"

  return (
    <div className="space-y-3">
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
          <p className="text-sm text-muted-foreground">Matches {target}.</p>
        ) : (
          <div className="space-y-1">
            <Button size="sm" variant="outline" onClick={() => match.check(serverVersion)} disabled={busy}>
              {match.state.status === "checking"
                ? "Checking…"
                : serverName
                  ? `Match ${serverName} (v${serverVersion})`
                  : "Match server version"}
            </Button>
            {!serverName && <p className="text-sm text-muted-foreground">Install v{serverVersion} to match your server.</p>}
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
    </div>
  )
}
