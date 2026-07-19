import { useState } from "react"
import { Lock, Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { TagDialog } from "@/components/tags/TagDialog"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useBulkDeleteTags, useDeleteTag, useTags } from "@/hooks/useTags"
import type { Tag } from "@/types/api"

export function TagsPage() {
  const { data, isLoading, isError, error } = useTags()
  const { selected, isSelected, toggle, clear, size, active } = useIdSelection()
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const bulkDeleteTags = useBulkDeleteTags()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Tags</h1>
        <TagDialog />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Failed to load tags: {(error as Error).message}</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tags yet. Create one, or add tags directly from a library item's edit dialog.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {active ? `${size} selected` : "Select tags to bulk edit"}
            </span>
            {active && (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!active}>
                  Bulk operations
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-48">
                <DropdownMenuItem onSelect={() => setBulkDeleteOpen(true)}>Delete selected…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
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
                            setBulkDeleteOpen(false)
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
          </div>

          <div className="space-y-2">
            {data.map((tag) => (
              <TagRow key={tag.id} tag={tag} selected={isSelected(tag.id)} onSelectedChange={() => toggle(tag.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TagRow({
  tag,
  selected,
  onSelectedChange,
}: {
  tag: Tag
  selected: boolean
  onSelectedChange: () => void
}) {
  const deleteTag = useDeleteTag()

  return (
    <div className="flex items-center gap-2 rounded-md border p-3">
      <Checkbox checked={selected} onCheckedChange={onSelectedChange} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {tag.isPrivate && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate font-medium">{tag.name}</span>
          <Badge variant="outline">
            {tag.usageCount} item{tag.usageCount === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>

      <div className="flex shrink-0 gap-1">
        <TagDialog
          tag={tag}
          trigger={
            <Button variant="ghost" size="icon" title="Rename">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" title="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{tag.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                It will be removed from {tag.usageCount} item{tag.usageCount === 1 ? "" : "s"}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteTag.mutate(tag.id)}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
