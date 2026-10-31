import { useCallback, useMemo, useState } from "react"
import { LogOut, MonitorSmartphone } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
import { useRevokeOtherSessions, useRevokeSession, useSessions } from "@/hooks/useSessions"
import { formatTimeAgo } from "@/lib/timeAgo"
import { describeDevice } from "@/lib/userAgent"
import type { ActiveSession } from "@/types/api"

const getSessionId = (s: ActiveSession) => s.id

export function SessionsCard() {
  const { data: sessions, isLoading, isError } = useSessions()
  const revoke = useRevokeSession()
  const revokeOthers = useRevokeOtherSessions()
  const [confirmOthers, setConfirmOthers] = useState(false)

  const others = sessions?.filter((s) => !s.current).length ?? 0

  // mutate keeps a stable identity (TanStack Query v5), so the memoized columns only rebuild when isPending flips.
  const { mutate: revokeSession, isPending: revoking } = revoke
  const signOut = useCallback(
    (s: ActiveSession) =>
      revokeSession(s, { onSuccess: () => !s.current && toast.success(`Signed out ${describeDevice(s.client, s.userAgent)}`) }),
    [revokeSession],
  )
  const columns = useMemo<ColumnDef<ActiveSession>[]>(
    () => [
      {
        key: "device",
        header: "Device",
        cell: (s) => (
          <div className="flex flex-wrap items-center gap-2">
            <span title={s.userAgent || undefined}>{describeDevice(s.client, s.userAgent)}</span>
            {s.current && <Badge variant="secondary">This device</Badge>}
          </div>
        ),
      },
      { key: "ip", header: "IP address", cellClassName: "font-mono text-xs", cell: (s) => s.ip || "—" },
      {
        key: "signedIn",
        header: "Signed in",
        type: "date",
        cellClassName: "whitespace-nowrap",
        cell: (s) => <span title={new Date(s.createdAt).toLocaleString()}>{new Date(s.createdAt).toLocaleDateString()}</span>,
      },
      {
        key: "lastActive",
        header: "Last active",
        type: "date",
        cellClassName: "whitespace-nowrap",
        cell: (s) => <span title={new Date(s.lastSeenAt).toLocaleString()}>{s.current ? "Now" : formatTimeAgo(s.lastSeenAt)}</span>,
      },
      {
        key: "actions",
        header: "",
        type: "icon",
        headerClassName: "w-10",
        cell: (s) => {
          const device = describeDevice(s.client, s.userAgent)
          return (
            <Button
              variant="ghost"
              size="icon"
              aria-label={s.current ? "Sign out this device" : `Sign out ${device}`}
              title={s.current ? "Sign out this device" : "Sign out"}
              disabled={revoking}
              onClick={() => signOut(s)}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )
        },
      },
    ],
    [revoking, signOut],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4" />
          Active sessions
        </CardTitle>
        <CardDescription>Devices currently signed in to this account. Sign out any you don't recognize.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-24 w-full" />}
        {isError && <p className="text-sm text-destructive">Couldn't load the active sessions.</p>}
        {sessions && (
          <>
            <DataTable
              rows={sessions}
              getRowId={getSessionId}
              columns={columns}
              className="gap-0"
              containerClassName="relative max-h-80 w-full overflow-auto"
            />

            <div className="flex items-center gap-3">
              <Button variant="outline" disabled={others === 0 || revokeOthers.isPending} onClick={() => setConfirmOthers(true)}>
                <LogOut className="h-4 w-4" />
                Sign out all other devices
              </Button>
              {others === 0 && <span className="text-sm text-muted-foreground">No other devices are signed in.</span>}
            </div>
          </>
        )}
      </CardContent>
      <AlertDialog open={confirmOthers} onOpenChange={setConfirmOthers}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Sign out {others} other device{others === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {others === 1 ? "That device" : "Those devices"} will have to sign in again. This device stays signed in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => revokeOthers.mutate()}>Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
