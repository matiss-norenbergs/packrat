import { useState } from "react"
import { PackratLogo } from "@/components/PackratLogo"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getLastServerUrl, normalizeServerUrl, probeServer, setServerUrl } from "@/lib/server"

// Desktop only: asks which Packrat server to talk to, checks it answers, then reloads so the
// router, auth check and every query start fresh against that server (see App.tsx).
export function ConnectPage() {
  const [address, setAddress] = useState(getLastServerUrl)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const handleConnect = async () => {
    const url = normalizeServerUrl(address)
    if (!url) {
      setError("Enter a valid address, e.g. 192.168.1.20:50505 or https://packrat.example.com")
      return
    }
    setPending(true)
    setError(null)
    const result = await probeServer(url)
    if (!result.ok) {
      setPending(false)
      setError(result.message)
      return
    }
    setServerUrl(url)
    window.location.reload()
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <PackratLogo className="h-5 w-5 shrink-0" />
            <span className="text-base font-semibold">Packrat</span>
          </div>
          <CardTitle>Connect to a server</CardTitle>
          <CardDescription>Enter the address of your Packrat server to continue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="server-url">Server address</Label>
            <Input
              id="server-url"
              placeholder="192.168.1.20:50505"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !pending && handleConnect()}
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <Button className="w-full" onClick={handleConnect} disabled={pending || !address.trim()}>
            {pending ? "Connecting…" : "Connect"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
