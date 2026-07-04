import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { EyeOff, RefreshCw, Settings2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { createImport } from "@/lib/api"
import { useImportScan } from "@/hooks/useImport"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import { libraryQueryKey } from "@/hooks/useLibrary"
import { collectionsQueryKey } from "@/hooks/useCollections"
import { formatBytes, formatDuration } from "@/lib/utils"
import type { ScannedFile } from "@/types/api"

export function ImportPage() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useImportScan()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [importingPaths, setImportingPaths] = useState<Set<string>>(new Set())
  const [importedPaths, setImportedPaths] = useState<Set<string>>(new Set())
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const queryClient = useQueryClient()

  const setUrlFor = (path: string, value: string) => {
    setUrls((prev) => ({ ...prev, [path]: value }))
  }

  const toggleSelected = (path: string, checked: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (checked) next.add(path)
      else next.delete(path)
      return next
    })
  }

  // Never re-fetches the scan list itself — only invalidates Library/
  // Collections so those stay in sync. Rescanning after every import felt
  // unnecessary; the scan list only refreshes on page load or Rescan.
  const importOne = async (file: ScannedFile) => {
    setImportingPaths((prev) => new Set(prev).add(file.path))
    try {
      await createImport({ path: file.path, originalUrl: urls[file.path]?.trim() || undefined })
      return true
    } catch (err) {
      toast.error(`Failed to import ${file.filename}: ${(err as Error).message}`)
      return false
    } finally {
      setImportingPaths((prev) => {
        const next = new Set(prev)
        next.delete(file.path)
        return next
      })
    }
  }

  const finishImport = (paths: string[]) => {
    setImportedPaths((prev) => {
      const next = new Set(prev)
      for (const p of paths) next.add(p)
      return next
    })
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      for (const p of paths) next.delete(p)
      return next
    })
    queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    queryClient.invalidateQueries({ queryKey: collectionsQueryKey })
  }

  const handleImportOne = async (file: ScannedFile) => {
    const ok = await importOne(file)
    if (ok) {
      toast.success(`Imported ${file.filename}`)
      finishImport([file.path])
    }
  }

  const importMany = async (files: ScannedFile[]) => {
    if (files.length === 0) return
    const results = await Promise.allSettled(files.map((f) => importOne(f)))
    const succeededPaths = files.filter((_, i) => results[i].status === "fulfilled" && (results[i] as PromiseFulfilledResult<boolean>).value).map((f) => f.path)
    const failed = files.length - succeededPaths.length

    finishImport(succeededPaths)

    if (failed === 0) {
      toast.success(`${succeededPaths.length} file${succeededPaths.length === 1 ? "" : "s"} imported`)
    } else {
      toast.error(`${succeededPaths.length} imported, ${failed} failed`)
    }
  }

  const pendingFiles = (data ?? []).filter((f) => !importedPaths.has(f.path))
  const selectedFiles = pendingFiles.filter((f) => selectedPaths.has(f.path))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Import</h1>
          <p className="text-sm text-muted-foreground">
            Files placed directly under your media root, outside the app.
          </p>
        </div>
        <div className="flex gap-2">
          <IgnoredFoldersDialog />
          <Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
            Rescan
          </Button>
          <Button onClick={() => importMany(selectedFiles)} disabled={selectedFiles.length === 0}>
            Import Selected
          </Button>
          <Button variant="outline" onClick={() => importMany(pendingFiles)} disabled={pendingFiles.length === 0}>
            Import All
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Failed to scan: {(error as Error).message}</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing new found. Rescan after placing files under your media root.
        </p>
      ) : (
        <div className="space-y-3">
          {data.map((file) => {
            const imported = importedPaths.has(file.path)
            return (
              <ScannedFileRow
                key={file.path}
                file={file}
                imported={imported}
                selected={selectedPaths.has(file.path)}
                onSelectedChange={(checked) => toggleSelected(file.path, checked)}
                url={urls[file.path] ?? ""}
                onUrlChange={(v) => setUrlFor(file.path, v)}
                importing={importingPaths.has(file.path)}
                onImport={() => handleImportOne(file)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function ScannedFileRow({
  file,
  imported,
  selected,
  onSelectedChange,
  url,
  onUrlChange,
  importing,
  onImport,
}: {
  file: ScannedFile
  imported: boolean
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  url: string
  onUrlChange: (value: string) => void
  importing: boolean
  onImport: () => void
}) {
  return (
    <div
      className={`flex flex-wrap items-end gap-3 rounded-md border p-3 ${imported ? "opacity-50" : ""}`}
    >
      <Checkbox
        checked={selected}
        disabled={imported}
        onCheckedChange={(v) => onSelectedChange(v === true)}
        className="mb-2"
      />

      <div className="min-w-[200px] flex-1 space-y-1">
        <p className="truncate font-medium">{file.filename}</p>
        <div className="flex items-center gap-1">
          <p className="truncate text-xs text-muted-foreground">
            {file.collectionPath ? file.collectionPath : "(media root)"}
            {file.newCollectionPath && ` — new: ${file.newCollectionPath}`}
          </p>
          {file.collectionPath && !imported && <IgnoreFolderButton folderPath={file.collectionPath} />}
        </div>
        <p className="text-xs text-muted-foreground">
          {formatBytes(file.sizeBytes)}
          {file.durationSeconds != null && ` · ${formatDuration(file.durationSeconds)}`}
          {file.resolution && ` · ${file.resolution}`}
        </p>
      </div>

      <div className="w-64 space-y-1">
        <Input
          placeholder="Original URL (optional)"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          disabled={imported}
        />
      </div>

      <Button onClick={onImport} disabled={imported || importing}>
        {imported ? "Imported" : importing ? "Importing…" : "Import"}
      </Button>
    </div>
  )
}

function IgnoreFolderButton({ folderPath }: { folderPath: string }) {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()

  const handleIgnore = () => {
    const current = settings?.importIgnoredFolders ?? []
    if (current.includes(folderPath)) return
    updateSettings.mutate({ importIgnoredFolders: [...current, folderPath] })
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5"
      title={`Ignore "${folderPath}" (and its sub-folders) in future scans`}
      onClick={handleIgnore}
    >
      <EyeOff className="h-3 w-3" />
    </Button>
  )
}

function IgnoredFoldersDialog() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const [newPath, setNewPath] = useState("")
  const folders = settings?.importIgnoredFolders ?? []

  const handleAdd = () => {
    const trimmed = newPath.trim()
    if (!trimmed || folders.includes(trimmed)) return
    updateSettings.mutate({ importIgnoredFolders: [...folders, trimmed] }, { onSuccess: () => setNewPath("") })
  }

  const handleRemove = (path: string) => {
    updateSettings.mutate({ importIgnoredFolders: folders.filter((f) => f !== path) })
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 className="h-4 w-4" />
          Ignored Folders
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ignored Folders</DialogTitle>
          <DialogDescription>
            Files under these folders (relative to your media root, including sub-folders) never
            show up in scan results.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {folders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ignored folders yet.</p>
          ) : (
            <ul className="space-y-1">
              {folders.map((path) => (
                <li key={path} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span className="truncate font-mono">{path}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemove(path)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Input
              placeholder="e.g. Raw or Shows/BehindTheScenes"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
            />
            <Button variant="secondary" onClick={handleAdd} disabled={!newPath.trim()}>
              Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
