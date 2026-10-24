import { useState } from "react"
import { Pencil, Plus, Server, Trash2 } from "lucide-react"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { startAddingServer } from "@/lib/serverSwitch"
import {
  changeProfileUrl,
  getActiveProfile,
  getProfiles,
  getTokenStorage,
  isTauri,
  normalizeServerUrl,
  probeServer,
  reloadApp,
  removeProfile,
  renameProfile,
  type ServerProfile,
} from "@/lib/server"
import { formatTimeAgo } from "@/lib/timeAgo"

// Settings → Desktop → Servers: the saved server profiles. Name and address are edited in a dialog
// together with the address (re-checked against /api/health before it is saved); removing a server
// also deletes its stored login. Changing or removing the active server reloads the app.
export function ServersSection() {
  const [, refresh] = useState(0)
  const [editing, setEditing] = useState<ServerProfile | null>(null)
  const [removing, setRemoving] = useState<ServerProfile | null>(null)
  const profiles = getProfiles()
  const activeId = getActiveProfile()?.id

  const confirmRemove = async () => {
    if (!removing) return
    const wasActive = removing.id === activeId
    await removeProfile(removing.id)
    setRemoving(null)
    if (wasActive) reloadApp()
    else refresh((n) => n + 1)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-4 w-4" />
          Servers
        </CardTitle>
        <CardDescription>The Packrat servers this app can connect to. Each keeps its own login.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Button size="sm" variant="outline" onClick={startAddingServer}>
            <Plus className="h-4 w-4" />
            Add server…
          </Button>
        </div>
        <Table containerClassName="relative max-h-80 w-full overflow-auto">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="text-center">Last used</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No saved servers.
                </TableCell>
              </TableRow>
            )}
            {profiles.map((profile) => (
              <TableRow key={profile.id}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{profile.name}</span>
                    {profile.id === activeId && <Badge variant="secondary">Current</Badge>}
                  </div>
                </TableCell>
                <TableCell className="break-all font-mono text-xs">{profile.url}</TableCell>
                <TableCell className="text-center whitespace-nowrap" title={new Date(profile.lastUsedAt).toLocaleString()}>
                  {profile.id === activeId ? "Now" : formatTimeAgo(new Date(profile.lastUsedAt).toISOString())}
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${profile.name}`}
                      title="Edit"
                      onClick={() => setEditing(profile)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${profile.name}`}
                      title="Remove"
                      onClick={() => setRemoving(profile)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {isTauri() && (
          <p className="text-xs text-muted-foreground">
            Token storage: {getTokenStorage() === "keychain" ? "OS keychain" : "Local file (keychain unavailable)"}
          </p>
        )}
      </CardContent>

      <EditServerDialog
        // Remounted per server so its fields start from that profile.
        key={editing?.id ?? "none"}
        profile={editing}
        isActive={editing?.id === activeId}
        onClose={() => setEditing(null)}
        onSaved={(restart) => {
          setEditing(null)
          if (restart) reloadApp()
          else refresh((n) => n + 1)
        }}
      />

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This signs you out of the server (if it can be reached), forgets it and deletes this app's saved
              login for it. Nothing else on the server is changed.
              {removing?.id === activeId && " It's the server you're connected to, so you'll be taken to the connect screen."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function EditServerDialog({
  profile,
  isActive,
  onClose,
  onSaved,
}: {
  profile: ServerProfile | null
  isActive: boolean
  onClose: () => void
  onSaved: (restart: boolean) => void
}) {
  const [name, setName] = useState(profile?.name ?? "")
  const [address, setAddress] = useState(profile?.url ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const save = async () => {
    if (!profile) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("Enter a name.")
      return
    }
    const url = normalizeServerUrl(address)
    if (!url) {
      setError("Enter a valid address, e.g. 192.168.1.20:50505 or https://packrat.example.com")
      return
    }
    const urlChanged = url !== profile.url
    if (urlChanged) {
      const clash = getProfiles().find((p) => p.id !== profile.id && p.url === url)
      if (clash) {
        setError(`That address is already saved as "${clash.name}".`)
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
      await changeProfileUrl(profile.id, url)
    }
    renameProfile(profile.id, trimmedName)
    setPending(false)
    onSaved(isActive && urlChanged)
  }

  return (
    <Dialog open={profile !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit server</DialogTitle>
          <DialogDescription>
            A new address is checked before it's saved. Changing it signs you out of this server on this
            device.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-server-name">Name</Label>
            <Input
              id="edit-server-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !pending && save()}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-server-address">Address</Label>
            <Input
              id="edit-server-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !pending && save()}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !name.trim() || !address.trim()}>
            {pending ? "Checking…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
