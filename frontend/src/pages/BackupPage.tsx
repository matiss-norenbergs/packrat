import { useRef, useState } from "react"
import { Info } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BackupHistoryTable } from "@/components/backup/BackupHistoryTable"
import { FullImportPreviewDialog } from "@/components/backup/FullImportPreviewDialog"
import { LibraryImportPreviewDialog } from "@/components/backup/LibraryImportPreviewDialog"
import {
  useExportLibrary,
  useExportSettings,
  useFullImportPreview,
  useImportFullBackup,
  useImportLibrary,
  useImportSettings,
  useLibraryImportPreview,
} from "@/hooks/useBackup"
import type { FullImportPreview, LibraryImportMode, LibraryImportPreview } from "@/types/api"

export function BackupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Backup</h1>
        <p className="text-sm text-muted-foreground">
          Export your settings or library data to a file, and import them back in later — on this
          install or a fresh one.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SettingsBackupCard />
        <LibraryBackupCard />
        <FullBackupCard />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backup History</CardTitle>
        </CardHeader>
        <CardContent>
          <BackupHistoryTable />
        </CardContent>
      </Card>
    </div>
  )
}

function EncryptFields({
  encrypt,
  setEncrypt,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  idPrefix,
}: {
  encrypt: boolean
  setEncrypt: (v: boolean) => void
  password: string
  setPassword: (v: string) => void
  confirmPassword: string
  setConfirmPassword: (v: string) => void
  idPrefix: string
}) {
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword
  return (
    <>
      <div className="flex items-start gap-2">
        <Checkbox
          id={`${idPrefix}-encrypt`}
          checked={encrypt}
          onCheckedChange={(v) => setEncrypt(v === true)}
        />
        <Label htmlFor={`${idPrefix}-encrypt`} className="font-normal">
          Encrypt this export
        </Label>
      </div>
      {encrypt && (
        <div className="space-y-3 pl-6">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-password`}>Password</Label>
            <Input
              id={`${idPrefix}-password`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-confirm`}>Confirm Password</Label>
            <Input
              id={`${idPrefix}-confirm`}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {mismatch && <p className="text-xs text-destructive">Passwords don't match</p>}
          </div>
        </div>
      )}
    </>
  )
}

function SettingsBackupCard() {
  const [encrypt, setEncrypt] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword
  const canExport = !encrypt || (password.length > 0 && !mismatch)
  const exportMutation = useExportSettings()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileText, setFileText] = useState("")
  const [needsPassword, setNeedsPassword] = useState(false)
  const [importPassword, setImportPassword] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const importMutation = useImportSettings()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setImportPassword("")
    if (!file) {
      setFileText("")
      setNeedsPassword(false)
      return
    }
    const text = await file.text()
    setFileText(text)
    try {
      setNeedsPassword(Boolean(JSON.parse(text).encrypted))
    } catch {
      setNeedsPassword(false)
    }
  }

  const canImport = fileText.length > 0 && (!needsPassword || importPassword.length > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Export</h3>
          <EncryptFields
            encrypt={encrypt}
            setEncrypt={setEncrypt}
            password={password}
            setPassword={setPassword}
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            idPrefix="settings-export"
          />
          <Button
            onClick={() => exportMutation.mutate(encrypt ? password : "")}
            disabled={!canExport || exportMutation.isPending}
          >
            {exportMutation.isPending ? "Exporting…" : "Export"}
          </Button>
        </div>

        <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-medium">Import</h3>
          <Input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChange} />
          {needsPassword && (
            <div className="space-y-2">
              <Label htmlFor="settings-import-password">Password</Label>
              <Input
                id="settings-import-password"
                type="password"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
              />
            </div>
          )}
          <Button variant="outline" onClick={() => setConfirmOpen(true)} disabled={!canImport || importMutation.isPending}>
            {importMutation.isPending ? "Importing…" : "Import"}
          </Button>
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Import settings from this file?</AlertDialogTitle>
              <AlertDialogDescription>
                This will overwrite your current settings with the values from this file.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  importMutation.mutate(
                    { data: fileText, password: importPassword },
                    {
                      onSuccess: () => {
                        setFileText("")
                        setNeedsPassword(false)
                        setImportPassword("")
                        if (fileInputRef.current) fileInputRef.current.value = ""
                      },
                    },
                  )
                }
              >
                Import
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

function LibraryBackupCard() {
  const [exportInfoOpen, setExportInfoOpen] = useState(false)
  const [encrypt, setEncrypt] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword
  const canExport = !encrypt || (password.length > 0 && !mismatch)
  const exportMutation = useExportLibrary()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileText, setFileText] = useState("")
  const [needsPassword, setNeedsPassword] = useState(false)
  const [importPassword, setImportPassword] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const importMutation = useImportLibrary()

  const previewMutation = useLibraryImportPreview()
  const [preview, setPreview] = useState<LibraryImportPreview | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [importMode, setImportMode] = useState<LibraryImportMode>("download")

  const resetImportState = () => {
    setFileText("")
    setNeedsPassword(false)
    setImportPassword("")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setImportPassword("")
    if (!file) {
      setFileText("")
      setNeedsPassword(false)
      return
    }
    const text = await file.text()
    setFileText(text)
    try {
      setNeedsPassword(Boolean(JSON.parse(text).encrypted))
    } catch {
      setNeedsPassword(false)
    }
  }

  const canImport = fileText.length > 0 && (!needsPassword || importPassword.length > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Library Data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-medium">Export</h3>
            <Popover open={exportInfoOpen} onOpenChange={setExportInfoOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground"
                  onMouseEnter={() => setExportInfoOpen(true)}
                  onMouseLeave={() => setExportInfoOpen(false)}
                >
                  <Info className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="text-xs text-muted-foreground"
                onMouseEnter={() => setExportInfoOpen(true)}
                onMouseLeave={() => setExportInfoOpen(false)}
              >
                Tags, collections, artists, and every library item — not the media files
                themselves. Importing this elsewhere re-queues downloads for items with a saved
                source URL; items without one are restored as ghost placeholders.
              </PopoverContent>
            </Popover>
          </div>
          <EncryptFields
            encrypt={encrypt}
            setEncrypt={setEncrypt}
            password={password}
            setPassword={setPassword}
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            idPrefix="library-export"
          />
          <Button
            onClick={() => exportMutation.mutate(encrypt ? password : "")}
            disabled={!canExport || exportMutation.isPending}
          >
            {exportMutation.isPending ? "Exporting…" : "Export"}
          </Button>
        </div>

        <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-medium">Import</h3>
          <Input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChange} />
          {needsPassword && (
            <div className="space-y-2">
              <Label htmlFor="library-import-password">Password</Label>
              <Input
                id="library-import-password"
                type="password"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                previewMutation.mutate(
                  { data: fileText, password: importPassword },
                  {
                    onSuccess: (result) => {
                      setPreview(result)
                      setPreviewOpen(true)
                    },
                  },
                )
              }
              disabled={!canImport || previewMutation.isPending}
            >
              {previewMutation.isPending ? "Loading preview…" : "Preview"}
            </Button>
            <Button variant="outline" onClick={() => setConfirmOpen(true)} disabled={!canImport || importMutation.isPending}>
              {importMutation.isPending ? "Importing…" : "Import"}
            </Button>
          </div>
        </div>

        <LibraryImportPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          preview={preview}
          data={fileText}
          password={importPassword}
          mode={importMode}
          onModeChange={setImportMode}
          onImported={resetImportState}
        />

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Import library data from this file?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    This creates any missing collections, tags, and artists. Items with no saved
                    URL are always recreated as ghost placeholders, since there's nothing to
                    download them from.{" "}
                    {importMode === "ghostOnly"
                      ? "Every other item is also recreated as a ghost placeholder — nothing is downloaded."
                      : "Every other item with a saved URL gets a redownload queued, including ghost items that have one. Tags on redownloaded items aren't reapplied automatically — you'll need to retag them once they finish."}{" "}
                    Nothing existing is ever deleted.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="library-import-mode">Items with a saved URL</Label>
                    <Select value={importMode} onValueChange={(v) => setImportMode(v as LibraryImportMode)}>
                      <SelectTrigger id="library-import-mode" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="download">Import and download</SelectItem>
                        <SelectItem value="ghostOnly">Import as ghost items</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  importMutation.mutate(
                    { data: fileText, password: importPassword, mode: importMode },
                    { onSuccess: resetImportState },
                  )
                }
              >
                Import
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

function FullBackupCard() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileText, setFileText] = useState("")
  const [needsPassword, setNeedsPassword] = useState(false)
  const [importPassword, setImportPassword] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [importMode, setImportMode] = useState<LibraryImportMode>("download")
  const importMutation = useImportFullBackup()

  const previewMutation = useFullImportPreview()
  const [preview, setPreview] = useState<FullImportPreview | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const resetImportState = () => {
    setFileText("")
    setNeedsPassword(false)
    setImportPassword("")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setImportPassword("")
    if (!file) {
      setFileText("")
      setNeedsPassword(false)
      return
    }
    const text = await file.text()
    setFileText(text)
    try {
      setNeedsPassword(Boolean(JSON.parse(text).encrypted))
    } catch {
      setNeedsPassword(false)
    }
  }

  const canImport = fileText.length > 0 && (!needsPassword || importPassword.length > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Full Backup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Import a full backup file — settings and library data together, both applied in one
            action. Get one from a Backup History row's Download button (on this install or
            another).
          </p>
          <Input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChange} />
          {needsPassword && (
            <div className="space-y-2">
              <Label htmlFor="full-import-password">Password</Label>
              <Input
                id="full-import-password"
                type="password"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                previewMutation.mutate(
                  { data: fileText, password: importPassword },
                  {
                    onSuccess: (result) => {
                      setPreview(result)
                      setPreviewOpen(true)
                    },
                  },
                )
              }
              disabled={!canImport || previewMutation.isPending}
            >
              {previewMutation.isPending ? "Loading preview…" : "Preview"}
            </Button>
            <Button variant="outline" onClick={() => setConfirmOpen(true)} disabled={!canImport || importMutation.isPending}>
              {importMutation.isPending ? "Importing…" : "Import"}
            </Button>
          </div>
        </div>

        <FullImportPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          preview={preview}
          data={fileText}
          password={importPassword}
          mode={importMode}
          onModeChange={setImportMode}
          onImported={resetImportState}
        />

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Import this full backup?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    Settings are overwritten with the backed-up values. Any missing collections,
                    tags, artists, and library items are created — items with no saved URL are
                    always recreated as ghost placeholders, since there's nothing to download
                    them from.{" "}
                    {importMode === "ghostOnly"
                      ? "Every other item is also recreated as a ghost placeholder — nothing is downloaded."
                      : "Every other item with a saved URL gets a redownload queued, including ghost items that have one."}{" "}
                    Nothing existing is ever deleted.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="full-import-mode">Library items with a saved URL</Label>
                    <Select value={importMode} onValueChange={(v) => setImportMode(v as LibraryImportMode)}>
                      <SelectTrigger id="full-import-mode" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="download">Import and download</SelectItem>
                        <SelectItem value="ghostOnly">Import as ghost items</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  importMutation.mutate(
                    { data: fileText, password: importPassword, mode: importMode },
                    { onSuccess: resetImportState },
                  )
                }
              >
                Import
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
