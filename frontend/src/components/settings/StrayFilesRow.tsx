import { useEffect, useState } from "react"
import { SearchX, Trash2 } from "lucide-react"
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useDeleteStrayFiles, useScanStrayFiles } from "@/hooks/useMaintenance"
import { formatBytes } from "@/lib/utils"
import type { StrayFileEntry, StrayFilesResult } from "@/types/api"

const PAGE_SIZE = 50
const ITEM_LABEL = { singular: "file", plural: "files" }

const entryKey = (e: StrayFileEntry) => `${e.root}:${e.path}`
const entryLabel = (e: StrayFileEntry) => `Select ${e.path}`

const columns: ColumnDef<StrayFileEntry>[] = [
  { key: "root", header: "Root", width: 100, cellClassName: "text-muted-foreground", cell: (e) => e.root },
  {
    key: "path",
    header: "Path",
    cellClassName: "font-medium",
    cell: (e) => <span title={e.path}>{e.path}</span>,
  },
  { key: "reason", header: "Reason", width: 160, cellClassName: "text-muted-foreground", cell: (e) => e.reason },
  { key: "size", header: "Size", type: "number", cellClassName: "text-muted-foreground", cell: (e) => formatBytes(e.sizeBytes) },
  {
    key: "modified",
    header: "Modified",
    type: "date",
    width: 120,
    cellClassName: "text-muted-foreground",
    cell: (e) => new Date(e.modifiedAt).toLocaleDateString(),
  },
]

function summaryText(r: StrayFilesResult): string {
  return `${r.totals.count} stray file${r.totals.count === 1 ? "" : "s"} · ${formatBytes(r.totals.bytes)}`
}

// Settings → Library maintenance: the inverse of "Scan for Missing Files".
// One compact row (button + last-scan summary); the review table lives in a
// dialog so Settings itself stays uncluttered.
export function StrayFilesRow() {
  const scan = useScanStrayFiles()
  const del = useDeleteStrayFiles()
  const [result, setResult] = useState<StrayFilesResult | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Bumped by every new scan so the table goes back to page 1 (DataTable's resetKey).
  const [scanKey, setScanKey] = useState(0)
  const selection = useIdSelection<string>()
  const { selected, clear } = selection

  const entries = result?.entries ?? []
  const selectedEntries = entries.filter((e) => selected.has(entryKey(e)))
  const selectedBytes = selectedEntries.reduce((sum, e) => sum + e.sizeBytes, 0)

  // The table clears the selection when the page changes; opening or closing the dialog starts afresh too.
  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const applyResult = (r: StrayFilesResult) => {
    setResult(r)
    setScanKey((k) => k + 1)
    clear()
    if (r.totals.count === 0) {
      setOpen(false)
      toast.success("No stray files found")
    }
  }

  const runScan = () => {
    scan.mutate(undefined, {
      onSuccess: (r) => {
        setResult(r)
        if (r.totals.count === 0) {
          toast.success("No stray files found")
          return
        }
        setScanKey((k) => k + 1)
        setOpen(true)
      },
    })
  }

  const runDelete = () => {
    del.mutate(
      selectedEntries.map(({ root, path }) => ({ root, path })),
      {
        // Refresh in place from a fresh scan (also updates the Settings summary).
        onSettled: () => scan.mutate(undefined, { onSuccess: applyResult }),
      },
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={runScan} disabled={scan.isPending || del.isPending}>
          <SearchX />
          {scan.isPending && !open ? "Scanning…" : "Find Stray Files"}
        </Button>
        {result && <span className="text-sm text-muted-foreground">{summaryText(result)}</span>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] min-w-0 flex-col sm:max-w-3xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Stray files</DialogTitle>
            <DialogDescription>
              Files on disk that no database record references. {result ? summaryText(result) : ""} reclaimable.
              Nothing is deleted until you confirm.
            </DialogDescription>
          </DialogHeader>

          {/* The table fills the height the dialog leaves (nested flex columns, all min-h-0), so only its own
              container scrolls and the header stays put. */}
          <DataTable
            className="gap-4"
            rows={entries}
            getRowId={entryKey}
            columns={columns}
            selection="multi"
            selectionState={selection}
            getRowLabel={entryLabel}
            pageSize={PAGE_SIZE}
            itemLabel={ITEM_LABEL}
            resetKey={scanKey}
            regionClassName="flex flex-col overflow-hidden rounded-md border"
            containerClassName="min-h-0 flex-1 overflow-auto"
          />

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              variant="destructive"
              disabled={selectedEntries.length === 0 || del.isPending || scan.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 />
              {del.isPending ? "Deleting…" : `Delete selected${selectedEntries.length > 0 ? ` (${selectedEntries.length})` : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedEntries.length} stray file{selectedEntries.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {selectedEntries.length} item{selectedEntries.length === 1 ? "" : "s"} ({formatBytes(selectedBytes)}) from
              disk. Each one is re-checked first, and anything that is no longer stray is skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
