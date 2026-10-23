import type { ReactNode } from "react"
import { PackratLogo } from "@/components/PackratLogo"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConnectionBanner } from "@/components/ConnectionBanner"
import { VersionMismatchNotice } from "@/components/VersionMismatchNotice"
import { useAuthStatus } from "@/hooks/useAuth"
import { useDownloadToasts } from "@/hooks/useDownloadToasts"
import { getServerUrl, isDesktop, isTauri, resetServer } from "@/lib/server"

// Desktop only: if the very first auth check fails (server down, wrong network), the layouts would
// otherwise render nothing at all. Show what's wrong and let the user retry or pick another server.
// The status query is shared with the layouts, so this adds no request. Web: passes children through.
export function DesktopGate({ children }: { children: ReactNode }) {
  const { data, isError, refetch, isFetching } = useAuthStatus()
  useDownloadToasts()
  if (!isDesktop() || data || !isError) {
    return (
      <>
        <ConnectionBanner />
        {isTauri() && data?.authenticated && <VersionMismatchNotice />}
        {children}
      </>
    )
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <PackratLogo className="h-5 w-5 shrink-0" />
            <span className="text-base font-semibold">Packrat</span>
          </div>
          <CardTitle>Can't reach the server</CardTitle>
          <CardDescription className="break-all">{getServerUrl()}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button className="flex-1" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Retrying…" : "Retry"}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              resetServer()
              window.location.reload()
            }}
          >
            Change server
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
