import { useEffect, useRef, useState } from "react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useDeleteStrayFiles, useScanStrayFiles } from "@/hooks/useMaintenance"
import { getPageNumbers } from "@/lib/pagination"
import { formatBytes } from "@/lib/utils"
import type { StrayFileEntry, StrayFilesResult } from "@/types/api"

const PAGE_SIZE = 50

const entryKey = (e: StrayFileEntry) => `${e.root}:${e.path}`

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
  const [page, setPage] = useState(1)
  const { selected, isSelected, toggle, clear, selectAll, selectOnly } = useIdSelection<string>()

  const [isDragging, setIsDragging] = useState(false)
  const dragAnchorRef = useRef<string | null>(null)

  const entries = result?.entries ?? []
  const total = entries.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageData = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allSelected = pageData.length > 0 && pageData.every((e) => isSelected(entryKey(e)))
  const someSelected = pageData.some((e) => isSelected(entryKey(e))) && !allSelected
  const selectedEntries = entries.filter((e) => selected.has(entryKey(e)))
  const selectedBytes = selectedEntries.reduce((sum, e) => sum + e.sizeBytes, 0)

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  // Selection is scoped to the visible page, same as the other bulk tables.
  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, open])

  useEffect(() => {
    if (!isDragging) return
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [isDragging])

  const applyResult = (r: StrayFilesResult) => {
    setResult(r)
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
        setPage(1)
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

  const isCheckboxTarget = (e: React.MouseEvent) => (e.target as HTMLElement).closest('[role="checkbox"]') != null

  const rangeKeys = (anchor: string, target: string) => {
    const a = pageData.findIndex((e) => entryKey(e) === anchor)
    const t = pageData.findIndex((e) => entryKey(e) === target)
    if (a === -1 || t === -1) return null
    const [start, end] = a < t ? [a, t] : [t, a]
    return pageData.slice(start, end + 1).map(entryKey)
  }

  // Click selects only this row, ctrl/cmd toggles, shift selects a range, and
  // dragging extends — same conventions as the other selection tables.
  const handleRowMouseDown = (e: React.MouseEvent, key: string) => {
    if (e.button !== 0 || isCheckboxTarget(e)) return
    e.preventDefault()
    if (e.shiftKey && dragAnchorRef.current != null) {
      const keys = rangeKeys(dragAnchorRef.current, key)
      if (keys) {
        selectAll(keys)
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      toggle(key)
      dragAnchorRef.current = key
      return
    }
    dragAnchorRef.current = key
    setIsDragging(true)
    selectOnly(key)
  }

  const handleRowMouseEnter = (key: string) => {
    if (!isDragging || dragAnchorRef.current == null) return
    const keys = rangeKeys(dragAnchorRef.current, key)
    if (keys) selectAll(keys)
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

          <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
            <Table containerClassName="h-full overflow-auto">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-center">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={(checked) => (checked ? selectAll(pageData.map(entryKey)) : clear())}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Root</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="text-center">Modified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageData.map((entry) => {
                  const key = entryKey(entry)
                  return (
                    <TableRow
                      key={key}
                      data-state={isSelected(key) ? "selected" : undefined}
                      className="cursor-default select-none"
                      onMouseDown={(e) => handleRowMouseDown(e, key)}
                      onMouseEnter={() => handleRowMouseEnter(key)}
                    >
                      <TableCell className="text-center">
                        <Checkbox
                          checked={isSelected(key)}
                          onCheckedChange={() => toggle(key)}
                          aria-label={`Select ${entry.path}`}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{entry.root}</TableCell>
                      <TableCell className="max-w-[280px] truncate font-medium" title={entry.path}>
                        {entry.path}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{entry.reason}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatBytes(entry.sizeBytes)}</TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {new Date(entry.modifiedAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex shrink-0 items-center justify-end gap-1">
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
          )}

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
