import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Eye, FilterX, Trash2 } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
import { MultiSelectFilter } from "@/components/logs/MultiSelectFilter"
import { SystemEventDetailDialog } from "@/components/logs/SystemEventDetailDialog"
import { SYSTEM_EVENT_LEVEL_VARIANT } from "@/components/logs/systemEventLevel"
import { useIdSelection } from "@/hooks/useIdSelection"
import { usePageState } from "@/hooks/usePageState"
import { useDeleteSystemEvents, useSystemEventFacets, useSystemEvents } from "@/hooks/useSystemEvents"
import type { SystemEvent, SystemEventQuery, SystemEventSortKey } from "@/types/api"

const PAGE_SIZE = 50
const DEFAULT_SORT = { key: "createdAt", dir: "desc" } as const
const SORT_KEYS: readonly string[] = ["createdAt", "level", "category"]
const NO_EVENTS: SystemEvent[] = []
const ITEM_LABEL = { singular: "event", plural: "events" }
const getEventId = (e: SystemEvent) => e.id

// The column keys are the server's sort keys, so the table's sort IS the query's sort; `sortValue` only marks a column
// sortable (a controlled table never sorts rows).
const COLUMNS: ColumnDef<SystemEvent>[] = [
  {
    key: "createdAt",
    header: "Time",
    type: "date",
    cellClassName: "text-muted-foreground",
    sortValue: (e) => new Date(e.createdAt),
    cell: (e) => new Date(e.createdAt).toLocaleString(),
  },
  {
    key: "level",
    header: "Level",
    type: "status",
    sortValue: (e) => e.level,
    cell: (e) => <Badge variant={SYSTEM_EVENT_LEVEL_VARIANT[e.level] ?? "secondary"} className="capitalize">{e.level}</Badge>,
  },
  {
    key: "category",
    header: "Category",
    width: 140,
    sortValue: (e) => e.category,
    cell: (e) => <span className="capitalize">{e.category}</span>,
  },
  {
    key: "message",
    header: "Message",
    width: 320,
    flex: true,
    cell: (e) => <p className="truncate">{e.message}</p>,
  },
]

const csv = (value: string | null): string[] => (value ?? "").split(",").filter(Boolean)

// A local calendar day (YYYY-MM-DD) as the instant it starts / ends in the user's timezone, so "to Mar 3" means the
// whole of their March 3rd and not the UTC one.
function dayBoundary(day: string, end: boolean): string | undefined {
  const [y, m, d] = day.split("-").map(Number)
  if (!y || !m || !d) return undefined
  return (end ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d)).toISOString()
}

export function SystemLogView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selection = useIdSelection()
  const { selected, size } = selection
  const [viewing, setViewing] = useState<SystemEvent | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deleteEvents = useDeleteSystemEvents()

  // Filters and sort live in the URL (they survive navigation); the page is state that goes back to 1 when any of them changes.
  const levels = csv(searchParams.get("level"))
  const categories = csv(searchParams.get("category"))
  const q = searchParams.get("q") ?? ""
  const from = searchParams.get("from") ?? ""
  const to = searchParams.get("to") ?? ""
  const rawSort = searchParams.get("sort")
  const sortKey = (rawSort && SORT_KEYS.includes(rawSort) ? rawSort : DEFAULT_SORT.key) as SystemEventSortKey
  const rawDir = searchParams.get("dir")
  const sortDir: "asc" | "desc" = rawDir === "asc" || rawDir === "desc" ? rawDir : sortKey === DEFAULT_SORT.key ? DEFAULT_SORT.dir : "asc"
  const hasFilters = levels.length > 0 || categories.length > 0 || q !== "" || from !== "" || to !== ""

  const [page, setPage] = usePageState(JSON.stringify([levels, categories, q, from, to, sortKey, sortDir]))

  const query: SystemEventQuery = {
    levels,
    categories,
    q: q || undefined,
    from: from ? dayBoundary(from, false) : undefined,
    to: to ? dayBoundary(to, true) : undefined,
    sort: sortKey,
    dir: sortDir,
    page,
    pageSize: PAGE_SIZE,
  }
  const { data, isLoading, isError, error } = useSystemEvents(query)
  const { data: facets } = useSystemEventFacets()
  const events = data?.items ?? NO_EVENTS
  const total = data?.total ?? 0

  // Any change of the query starts a fresh selection: the selected rows may no longer be on the page.
  const update = (changes: Record<string, string | null>) => {
    selection.clear()
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      { replace: true },
    )
  }
  const clearFilters = () => update({ level: null, category: null, q: null, from: null, to: null })

  const layout = useMemo(() => ({ v: 1 as const, sort: { key: sortKey, dir: sortDir } }), [sortKey, sortDir])
  const levelOptions = (facets?.levels ?? []).map((f) => ({ value: f.value, label: f.value, count: f.count }))
  const categoryOptions = (facets?.categories ?? []).map((f) => ({ value: f.value, label: f.value, count: f.count }))

  const confirmDelete = () => {
    const ids = [...selected] as number[]
    setConfirmingDelete(false)
    deleteEvents.mutate({ ids }, { onSuccess: () => selection.clear() })
  }

  return (
    <>
      <DataTable
        rows={events}
        getRowId={getEventId}
        columns={COLUMNS}
        layout={layout}
        onLayoutChange={(l) => {
          const s = l.sort
          // A cycle back to "no explicit sort" returns to the default (newest first).
          update({ sort: s && s.key !== DEFAULT_SORT.key ? s.key : null, dir: s && !(s.key === DEFAULT_SORT.key && s.dir === DEFAULT_SORT.dir) ? s.dir : null })
        }}
        defaultSort={DEFAULT_SORT}
        selection="multi"
        selectionState={selection}
        getRowLabel={(e) => `Select event ${e.id}: ${e.message}`}
        loading={isLoading}
        error={isError ? <p className="text-sm text-destructive">Failed to load the system log: {(error as Error).message}</p> : undefined}
        empty={
          hasFilters ? (
            <p className="text-sm text-muted-foreground">No events match these filters.</p>
          ) : (
            <p className="text-sm text-muted-foreground">No system events recorded yet. Startups, migrations, backups and other notable server events will show up here.</p>
          )
        }
        search={{ value: q, onChange: (value) => update({ q: value || null }), placeholder: "Search messages…" }}
        pagination={{ page, pageSize: PAGE_SIZE, total, onPageChange: (p) => { selection.clear(); setPage(p) }, itemLabel: ITEM_LABEL }}
        toolbar={
          <Button size="sm" variant="outline" disabled={size === 0 || deleteEvents.isPending} onClick={() => setConfirmingDelete(true)}>
            <Trash2 />
            Delete
          </Button>
        }
        filters={
          <>
            <MultiSelectFilter label="Level" options={levelOptions} selected={levels} onChange={(v) => update({ level: v.join(",") || null })} />
            <MultiSelectFilter label="Category" options={categoryOptions} selected={categories} onChange={(v) => update({ category: v.join(",") || null })} />
            <Input type="date" aria-label="From date" className="w-full sm:w-[150px]" value={from} max={to || undefined} onChange={(e) => update({ from: e.target.value || null })} />
            <Input type="date" aria-label="To date" className="w-full sm:w-[150px]" value={to} min={from || undefined} onChange={(e) => update({ to: e.target.value || null })} />
            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                <FilterX />
                Clear filters
              </Button>
            )}
          </>
        }
        onRowDoubleClick={(e) => setViewing(e)}
        contextMenu={(rows) => [
          {
            key: "details",
            label: "View details",
            icon: <Eye />,
            disabled: rows.length !== 1,
            onSelect: ([e]) => setViewing(e),
          },
        ]}
      />

      {viewing && <SystemEventDetailDialog event={viewing} open onOpenChange={(open) => !open && setViewing(null)} />}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {size === 1 ? "1 event" : `${size} events`}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes {size === 1 ? "the selected event" : `the ${size} selected events`} from the system log. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
