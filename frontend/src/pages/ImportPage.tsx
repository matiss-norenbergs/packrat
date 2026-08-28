import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Download, EyeOff, FolderDown, RefreshCw, Search, Settings2, X } from "lucide-react"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { createImport } from "@/lib/api"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useImportScan } from "@/hooks/useImport"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import { libraryQueryKey } from "@/hooks/useLibrary"
import { collectionsQueryKey } from "@/hooks/useCollections"
import { getPageNumbers } from "@/lib/pagination"
import { formatBytes, formatDuration } from "@/lib/utils"
import type { ScannedFile } from "@/types/api"

const PAGE_SIZE = 50

export function ImportPage() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useImportScan()
  const { selected, isSelected, toggle, clear, selectAll, selectOnly, size } = useIdSelection<string>()
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [importingPaths, setImportingPaths] = useState<Set<string>>(new Set())
  const [importedPaths, setImportedPaths] = useState<Set<string>>(new Set())
  const [pendingAction, setPendingAction] = useState<"selected" | "all" | null>(null)
  const queryClient = useQueryClient()

  // Drag-to-select: mousedown on a row starts the drag and anchors the
  // range; mouseenter on subsequent rows while the button is held extends
  // the selection to every row between the anchor and the row under the
  // cursor — same convention as History/Tags/Artists. Clicks on the
  // checkbox, the URL input, or the per-row Import button never start a
  // drag — those need their own click to land normally.
  const [isDragging, setIsDragging] = useState(false)
  const dragAnchorPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isDragging) return
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [isDragging])

  const setUrlFor = (path: string, value: string) => {
    setUrls((prev) => ({ ...prev, [path]: value }))
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data ?? []
    return (data ?? []).filter((f) => f.filename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
  }, [data, search])
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pageSelectablePaths = pageData.filter((f) => !importedPaths.has(f.path)).map((f) => f.path)
  const allSelected = pageSelectablePaths.length > 0 && pageSelectablePaths.every((p) => selected.has(p))
  const someSelected = pageSelectablePaths.some((p) => selected.has(p)) && !allSelected

  // The selection is scoped to what's currently visible on this page — a
  // stale path from a previous page/search shouldn't silently ride along
  // once the rows it referred to are no longer on screen.
  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search])

  // A search that shrinks the result set out from under the current page
  // number would otherwise show an empty page instead of snapping back.
  useEffect(() => {
    setPage(1)
  }, [search])

  const isInteractiveTarget = (e: React.MouseEvent) =>
    (e.target as HTMLElement).closest('[role="checkbox"], input, button, a') != null

  const rangeIds = (anchorPath: string, targetPath: string) => {
    const anchorIdx = pageData.findIndex((f) => f.path === anchorPath)
    const targetIdx = pageData.findIndex((f) => f.path === targetPath)
    if (anchorIdx === -1 || targetIdx === -1) return null
    const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    return pageData.slice(start, end + 1).map((f) => f.path)
  }

  const handleRowMouseDown = (e: React.MouseEvent, path: string) => {
    if (e.button !== 0 || isInteractiveTarget(e) || importedPaths.has(path)) return
    e.preventDefault()

    if (e.shiftKey && dragAnchorPathRef.current != null) {
      const ids = rangeIds(dragAnchorPathRef.current, path)
      if (ids) {
        selectAll(ids)
        return
      }
    }

    if (e.ctrlKey || e.metaKey) {
      toggle(path)
      dragAnchorPathRef.current = path
      return
    }

    dragAnchorPathRef.current = path
    setIsDragging(true)
    selectOnly(path)
  }

  const handleRowMouseEnter = (path: string) => {
    if (!isDragging || dragAnchorPathRef.current == null) return
    const ids = rangeIds(dragAnchorPathRef.current, path)
    if (ids) selectAll(ids)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold">File Import</h1>
        <p className="text-sm text-muted-foreground">
          Files placed directly under your media root, outside the app.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
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

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <IgnoredFoldersDialog />
          <div className="relative min-w-[160px] max-w-[280px] flex-1 sm:min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search files…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Failed to scan: {(error as Error).message}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing new found. Rescan after placing files under your media root.
          </p>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">No files match your search.</p>
        ) : (
          // Single scroll container (both axes) via containerClassName — see
          // Table's doc comment in components/ui/table.tsx for why a second
          // overflow-y-auto wrapper would break the header's sticky positioning.
          <Table containerClassName="h-full overflow-auto rounded-md border">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 text-center">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(checked) => (checked ? selectAll(pageSelectablePaths) : clear())}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Resolution</TableHead>
                <TableHead className="text-right">Import</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageData.map((file) => {
                const imported = importedPaths.has(file.path)
                return (
                  <ScannedFileRow
                    key={file.path}
                    file={file}
                    imported={imported}
                    selected={isSelected(file.path)}
                    onSelectedChange={() => toggle(file.path)}
                    onMouseDown={(e) => handleRowMouseDown(e, file.path)}
                    onMouseEnter={() => handleRowMouseEnter(file.path)}
                    url={urls[file.path] ?? ""}
                    onUrlChange={(v) => setUrlFor(file.path, v)}
                    importing={importingPaths.has(file.path)}
                    onImport={() => handleImportOne(file)}
                  />
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {!isLoading && data && data.length > 0 && total > 0 && (
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? "file" : "files"}
            {size > 0 && ` · ${size} selected`}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            {getPageNumbers(page, totalPages).map((p, i) =>
              p === "ellipsis" ? (
                <span key={`ellipsis-${i}`} className="px-1.5 text-sm text-muted-foreground">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  className="w-8 px-0"
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              ),
            )}
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
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
  onMouseDown,
  onMouseEnter,
  url,
  onUrlChange,
  importing,
  onImport,
}: {
  file: ScannedFile
  imported: boolean
  selected: boolean
  onSelectedChange: () => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseEnter: () => void
  url: string
  onUrlChange: (value: string) => void
  importing: boolean
  onImport: () => void
}) {
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className={imported ? "opacity-50" : "cursor-default select-none"}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
    >
      <TableCell className="text-center">
        <Checkbox checked={selected} disabled={imported} onCheckedChange={onSelectedChange} />
      </TableCell>
      <TableCell>
        <p className="max-w-xs truncate font-medium">{file.filename}</p>
        <div className="flex items-center gap-1">
          <p className="max-w-xs truncate text-xs text-muted-foreground">
            {file.collectionPath ? file.collectionPath : "(media root)"}
            {file.newCollectionPath && ` — new: ${file.newCollectionPath}`}
          </p>
          {file.collectionPath && !imported && <IgnoreFolderButton folderPath={file.collectionPath} />}
        </div>
      </TableCell>
      <TableCell className="text-right text-muted-foreground">{formatBytes(file.sizeBytes)}</TableCell>
      <TableCell className="text-right text-muted-foreground">
        {file.durationSeconds != null ? formatDuration(file.durationSeconds) : "—"}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">{file.resolution ?? "—"}</TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <Input
            placeholder="Original URL (optional)"
            className="h-8 w-44"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            disabled={imported}
          />
          <Button size="sm" onClick={onImport} disabled={imported || importing}>
            <Download className="h-4 w-4" />
            {imported ? "Imported" : importing ? "Importing…" : "Import"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
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
