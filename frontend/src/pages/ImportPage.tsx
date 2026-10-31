import { createContext, useContext, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Download, EyeOff, FolderDown, RefreshCw, Settings2, X } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
import { useEvent } from "@/components/data-table/useEvent"
import { createImport } from "@/lib/api"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useImportScan } from "@/hooks/useImport"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import { libraryQueryKey } from "@/hooks/useLibrary"
import { collectionsQueryKey } from "@/hooks/useCollections"
import { formatBytes, formatDuration } from "@/lib/utils"
import type { ScannedFile } from "@/types/api"

const PAGE_SIZE = 50

// What the cells of the table know about the page. Everything the cells need that changes while the user works goes
// through here (the Importing / Imported flags change on import events only) or lives in `urls`, a ref map that is
// never state: typing in an Original URL input re-renders that input alone — not the page, the table or any other row —
// and the text outlives the row's unmounting (paging, sorting) because the input starts from the map again.
interface ImportRowsContext {
  /** Original URL typed per file path. */
  urls: Map<string, string>
  importing: ReadonlySet<string>
  imported: ReadonlySet<string>
  onImport: (file: ScannedFile) => void
}
const ImportRows = createContext<ImportRowsContext | null>(null)

function useImportRows(): ImportRowsContext {
  const ctx = useContext(ImportRows)
  if (!ctx) throw new Error("ImportRows context is missing")
  return ctx
}

const matchFile = (f: ScannedFile, q: string) => f.filename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)

// "1920x1080" → the pixel count; null (sorted last) when there is none or it does not parse.
function resolutionPixels(f: ScannedFile): number | null {
  const m = f.resolution ? /^(\d+)x(\d+)$/.exec(f.resolution) : null
  return m ? Number(m[1]) * Number(m[2]) : null
}

function NameCell({ file }: { file: ScannedFile }) {
  const { imported } = useImportRows()
  return (
    <>
      <p className="truncate font-medium">{file.filename}</p>
      <div className="flex items-center gap-1">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {file.collectionPath ? file.collectionPath : "(media root)"}
          {file.newCollectionPath && ` — new: ${file.newCollectionPath}`}
        </p>
        {file.collectionPath && !imported.has(file.path) && <IgnoreFolderButton folderPath={file.collectionPath} />}
      </div>
    </>
  )
}

// Keeps its own text, so typing re-renders nothing but this input; every change also goes to the page's map.
function UrlInput({ path, label, disabled }: { path: string; label: string; disabled: boolean }) {
  const { urls } = useImportRows()
  const [value, setValue] = useState(() => urls.get(path) ?? "")
  return (
    <Input
      placeholder="Original URL (optional)"
      aria-label={`Original URL for ${label}`}
      className="h-8 w-44 min-w-0"
      value={value}
      onChange={(e) => {
        setValue(e.target.value)
        urls.set(path, e.target.value)
      }}
      disabled={disabled}
    />
  )
}

function ImportCell({ file }: { file: ScannedFile }) {
  const { imported, importing, onImport } = useImportRows()
  const done = imported.has(file.path)
  return (
    <div className="flex items-center justify-end gap-2">
      <UrlInput path={file.path} label={file.filename} disabled={done} />
      <Button size="sm" className="min-w-28 shrink-0 justify-center whitespace-nowrap" onClick={() => onImport(file)} disabled={done || importing.has(file.path)}>
        <Download className="h-4 w-4" />
        {done ? "Imported" : importing.has(file.path) ? "Importing…" : "Import"}
      </Button>
    </div>
  )
}

// No closure over page state: the cells read the Importing / Imported flags and the handler from the context.
const columns: ColumnDef<ScannedFile>[] = [
  { key: "name", header: "Name", flex: true, width: 280, sortValue: (f) => f.filename, cell: (f) => <NameCell file={f} /> },
  {
    key: "size",
    header: "Size",
    type: "number",
    cellClassName: "text-muted-foreground",
    sortValue: (f) => f.sizeBytes,
    cell: (f) => formatBytes(f.sizeBytes),
  },
  {
    key: "duration",
    header: "Duration",
    type: "number",
    cellClassName: "text-muted-foreground",
    sortValue: (f) => f.durationSeconds,
    cell: (f) => (f.durationSeconds != null ? formatDuration(f.durationSeconds) : "—"),
  },
  {
    key: "resolution",
    header: "Resolution",
    type: "number",
    cellClassName: "text-muted-foreground",
    sortValue: resolutionPixels,
    cell: (f) => f.resolution ?? "—",
  },
  {
    key: "import",
    header: "Import",
    align: "right",
    width: 360,
    resizable: false,
    tooltip: false,
    cell: (f) => <ImportCell file={f} />,
  },
]

export function ImportPage() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useImportScan()
  const selection = useIdSelection<string>()
  const { selected, selectAll } = selection
  const [urls] = useState(() => new Map<string, string>())
  const [importingPaths, setImportingPaths] = useState<Set<string>>(new Set())
  const [importedPaths, setImportedPaths] = useState<Set<string>>(new Set())
  const [pendingAction, setPendingAction] = useState<"selected" | "all" | null>(null)
  const queryClient = useQueryClient()

  // Never re-fetches the scan list itself — only invalidates Library/
  // Collections so those stay in sync. Rescanning after every import felt
  // unnecessary; the scan list only refreshes on page load or Rescan.
  const importOne = async (file: ScannedFile) => {
    setImportingPaths((prev) => new Set(prev).add(file.path))
    try {
      await createImport({ path: file.path, originalUrl: urls.get(file.path)?.trim() || undefined })
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
    selectAll(Array.from(selected).filter((p) => !paths.includes(p)))
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
  const selectedFiles = pendingFiles.filter((f) => selected.has(f.path))
  const actionFiles = pendingAction === "selected" ? selectedFiles : pendingAction === "all" ? pendingFiles : []

  const confirmPendingAction = () => {
    const files = actionFiles
    setPendingAction(null)
    importMany(files)
  }

  // The context value only changes on import events; the handler is stable (it always runs the latest closure).
  const onImport = useEvent((file: ScannedFile) => void handleImportOne(file))
  const rowsContext = useMemo<ImportRowsContext>(
    () => ({ urls, importing: importingPaths, imported: importedPaths, onImport }),
    [urls, importingPaths, importedPaths, onImport],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold">File Import</h1>
        <p className="text-sm text-muted-foreground">
          Files placed directly under your media root, outside the app.
        </p>
      </div>

      <ImportRows.Provider value={rowsContext}>
        <DataTable
          rows={data ?? []}
          getRowId={(f) => f.path}
          columns={columns}
          tableId="import"
          selection="multi"
          selectionState={selection}
          getRowLabel={(f) => `Select ${f.filename}`}
          isRowSelectable={(f) => !importedPaths.has(f.path)}
          rowClassName={(f) => (importedPaths.has(f.path) ? "opacity-50" : undefined)}
          loading={isLoading}
          error={isError ? <p className="text-sm text-destructive">Failed to scan: {(error as Error).message}</p> : undefined}
          empty={
            !data || data.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing new found. Rescan after placing files under your media root.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No files match your search.</p>
            )
          }
          search={{ match: matchFile, placeholder: "Search files…" }}
          pageSize={PAGE_SIZE}
          itemLabel={{ singular: "file", plural: "files" }}
          toolbar={
            <>
              <Button size="sm" onClick={() => setPendingAction("selected")} disabled={selectedFiles.length === 0}>
                <Download className="h-4 w-4" />
                Import Selected
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPendingAction("all")} disabled={pendingFiles.length === 0}>
                <FolderDown className="h-4 w-4" />
                Import All
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
                Rescan
              </Button>
              <AlertDialog open={pendingAction != null} onOpenChange={(open) => !open && setPendingAction(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Import {actionFiles.length} {actionFiles.length === 1 ? "file" : "files"}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {pendingAction === "selected"
                        ? "Adds the selected files to your library."
                        : "Adds every pending file to your library."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmPendingAction}>Import</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          }
          filters={<IgnoredFoldersDialog />}
        />
      </ImportRows.Provider>
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleIgnore}>
          <EyeOff className="h-3 w-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{`Ignore "${folderPath}" (and its sub-folders) in future scans`}</TooltipContent>
    </Tooltip>
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
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4" />
          Ignored Folders
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
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
