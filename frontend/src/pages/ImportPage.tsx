import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { createImport } from "@/lib/api"
import { useImportScan, importScanQueryKey } from "@/hooks/useImport"
import { libraryQueryKey } from "@/hooks/useLibrary"
import { collectionsQueryKey } from "@/hooks/useCollections"
import { formatBytes, formatDuration } from "@/lib/utils"
import type { ScannedFile } from "@/types/api"

export function ImportPage() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useImportScan()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [importingPaths, setImportingPaths] = useState<Set<string>>(new Set())
  const queryClient = useQueryClient()

  const setUrlFor = (path: string, value: string) => {
    setUrls((prev) => ({ ...prev, [path]: value }))
  }

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

  const handleImportOne = async (file: ScannedFile) => {
    const ok = await importOne(file)
    if (ok) {
      toast.success(`Imported ${file.filename}`)
      queryClient.invalidateQueries({ queryKey: importScanQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: collectionsQueryKey })
    }
  }

  const handleImportAll = async () => {
    if (!data || data.length === 0) return
    const results = await Promise.allSettled(data.map((f) => importOne(f)))
    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value).length
    const failed = results.length - succeeded

    queryClient.invalidateQueries({ queryKey: importScanQueryKey })
    queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    queryClient.invalidateQueries({ queryKey: collectionsQueryKey })

    if (failed === 0) {
      toast.success(`${succeeded} file${succeeded === 1 ? "" : "s"} imported`)
    } else {
      toast.error(`${succeeded} imported, ${failed} failed`)
    }
  }

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
          <Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
            Rescan
          </Button>
          <Button onClick={handleImportAll} disabled={!data || data.length === 0}>
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
          {data.map((file) => (
            <div key={file.path} className="flex flex-wrap items-end gap-3 rounded-md border p-3">
              <div className="min-w-[200px] flex-1 space-y-1">
                <p className="truncate font-medium">{file.filename}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {file.collectionPath ? file.collectionPath : "(media root)"}
                  {file.newCollectionPath && ` — new: ${file.newCollectionPath}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.sizeBytes)}
                  {file.durationSeconds != null && ` · ${formatDuration(file.durationSeconds)}`}
                  {file.resolution && ` · ${file.resolution}`}
                </p>
              </div>

              <div className="w-64 space-y-1">
                <Input
                  placeholder="Original URL (optional)"
                  value={urls[file.path] ?? ""}
                  onChange={(e) => setUrlFor(file.path, e.target.value)}
                />
              </div>

              <Button
                onClick={() => handleImportOne(file)}
                disabled={importingPaths.has(file.path)}
              >
                {importingPaths.has(file.path) ? "Importing…" : "Import"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
