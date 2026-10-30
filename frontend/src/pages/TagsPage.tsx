import { useState } from "react"
import { Lock, Pencil, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { DataTable } from "@/components/data-table"
import type { ColumnDef, ContextMenuItemDef } from "@/components/data-table"
import { TagDialog } from "@/components/tags/TagDialog"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useSettings } from "@/hooks/useSettings"
import { useBulkDeleteTags, useTags } from "@/hooks/useTags"
import type { Tag } from "@/types/api"

const PAGE_SIZE = 50

const matchTag = (t: Tag, q: string) => t.name.toLowerCase().includes(q)

export function TagsPage() {
  const { data: settings } = useSettings()
  const { data, isLoading, isError, error } = useTags()
  const selection = useIdSelection()
  const { selected, clear, size, active } = selection
  const [newTagOpen, setNewTagOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const bulkDeleteTags = useBulkDeleteTags()

  const privacyEnabled = !!settings?.privacyEnabled
  const editTarget = size === 1 ? data?.find((t) => selected.has(t.id)) : undefined

  const columns: ColumnDef<Tag>[] = [
    { key: "name", header: "Name", cell: (t) => t.name, cellClassName: "font-medium" },
    {
      key: "usage",
      header: "Usage",
      type: "status",
      cell: (t) => (
        <Badge variant="outline">
          {t.usageCount} item{t.usageCount === 1 ? "" : "s"}
        </Badge>
      ),
    },
    ...(privacyEnabled
      ? [
          {
            key: "private",
            header: "Private",
            type: "icon",
            cell: (t) => t.isPrivate && <Lock className="h-3.5 w-3.5 text-primary" aria-label="Private" />,
          } satisfies ColumnDef<Tag>,
        ]
      : []),
  ]

  const contextMenu = (rows: Tag[]): ContextMenuItemDef<Tag>[] => [
    { key: "new", label: "New Tag", icon: <Plus className="h-4 w-4" />, onSelect: () => setNewTagOpen(true) },
    { key: "edit", label: "Edit", icon: <Pencil className="h-4 w-4" />, disabled: rows.length !== 1, onSelect: () => setEditOpen(true) },
    {
      key: "delete",
      label: `Delete${rows.length > 1 ? ` (${rows.length})` : ""}`,
      icon: <Trash2 className="h-4 w-4" />,
      destructive: true,
      disabled: rows.length === 0,
      onSelect: () => setDeleteOpen(true),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <h1 className="shrink-0 text-2xl font-semibold">Tags</h1>

      <DataTable
        rows={data ?? []}
        getRowId={(t) => t.id}
        columns={columns}
        selection="multi"
        selectionState={selection}
        getRowLabel={(t) => `Select ${t.name}`}
        loading={isLoading}
        error={isError ? <p className="text-sm text-destructive">Failed to load tags: {(error as Error).message}</p> : undefined}
        empty={(query) =>
          !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tags yet. Create one, or add tags directly from a library item's edit dialog.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No tags match "{query}".</p>
          )
        }
        search={{ value: "", match: matchTag, placeholder: "Search tags…" }}
        pageSize={PAGE_SIZE}
        itemLabel={{ singular: "tag", plural: "tags" }}
        contextMenu={contextMenu}
        toolbar={
          <>
            <Button size="sm" onClick={() => setNewTagOpen(true)}>
              <Plus className="h-4 w-4" />
              New Tag
            </Button>
            <TagDialog open={newTagOpen} onOpenChange={setNewTagOpen} />

            <Button variant="outline" size="sm" disabled={size !== 1} onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            {editTarget && <TagDialog open={editOpen} onOpenChange={setEditOpen} tag={editTarget} />}

            <Button variant="destructive" size="sm" disabled={!active} onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {size} selected tag{size === 1 ? "" : "s"}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    They'll be removed from every item that has them.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      bulkDeleteTags.mutate(
                        { ids: Array.from(selected) },
                        {
                          onSuccess: () => {
                            clear()
                            setDeleteOpen(false)
                          },
                        },
                      )
                    }
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />
    </div>
  )
}
