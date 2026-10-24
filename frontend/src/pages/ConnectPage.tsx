import { useState } from "react"
import { PackratLogo } from "@/components/PackratLogo"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { openProfile } from "@/lib/serverSwitch"
import {
  deriveProfileName,
  getLastServerUrl,
  getProfiles,
  isAddingServer,
  normalizeServerUrl,
  probeServer,
  reloadApp,
  setAddingServer,
  setServerUrl,
} from "@/lib/server"

// Desktop only: asks which Packrat server to talk to, checks it answers, saves it as a server
// profile and makes it the active one, then reloads so the router, auth check and every query start
// fresh against that server (see App.tsx). Shown on first run, after the active server was removed,
// and from the switcher's "Add server…" (then with a Cancel back to the current server).
export function ConnectPage() {
  const adding = isAddingServer()
  const profiles = getProfiles()
  const [address, setAddress] = useState(adding ? "" : getLastServerUrl)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const normalized = normalizeServerUrl(address)
  const suggestedName = normalized ? deriveProfileName(normalized, profiles.map((p) => p.name)) : "e.g. Home server"

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
    setServerUrl(url, name)
    setAddingServer(false)
    reloadApp()
  }

  const handleCancel = () => {
    setAddingServer(false)
    reloadApp()
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <PackratLogo className="h-5 w-5 shrink-0" />
            <span className="text-base font-semibold">Packrat</span>
          </div>
          <CardTitle>{adding ? "Add a server" : "Connect to a server"}</CardTitle>
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="server-name">
              Name <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="server-name"
              placeholder={suggestedName}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !pending && handleConnect()}
              maxLength={60}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="flex gap-2">
            {adding && (
              <Button variant="outline" className="flex-1" onClick={handleCancel} disabled={pending}>
                Cancel
              </Button>
            )}
            <Button className="flex-1" onClick={handleConnect} disabled={pending || !address.trim()}>
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </div>
          {profiles.length > 0 && (
            <div className="space-y-1 border-t pt-3">
              <p className="text-xs text-muted-foreground">Or use a saved server</p>
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => openProfile(profile.id)}
                >
                  <span className="truncate text-sm">{profile.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{profile.url}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
