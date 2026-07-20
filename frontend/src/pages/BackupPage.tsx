import { useRef, useState } from "react"
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
import { LibraryImportPreviewDialog } from "@/components/backup/LibraryImportPreviewDialog"
import {
  useExportLibrary,
  useExportSettings,
  useImportLibrary,
  useImportSettings,
  useLibraryImportPreview,
} from "@/hooks/useBackup"
import type { LibraryImportPreview } from "@/types/api"

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
        <SettingsBackupCard />
        <LibraryBackupCard />
      </div>
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
          <h3 className="text-sm font-medium">Export</h3>
          <p className="text-xs text-muted-foreground">
            Tags, collections, artists, and any library item with a saved source URL — not the
            media files themselves. Importing this elsewhere re-queues downloads from those URLs.
          </p>
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
          onImported={resetImportState}
        />

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Import library data from this file?</AlertDialogTitle>
              <AlertDialogDescription>
                This creates any missing collections, tags, and artists, and queues a redownload
                for every item with a saved URL in this file. Tags on redownloaded items aren't
                reapplied automatically — you'll need to retag them once they finish. Nothing
                existing is ever deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  importMutation.mutate(
                    { data: fileText, password: importPassword },
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
