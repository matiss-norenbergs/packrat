import { Pencil, Trash2 } from "lucide-react"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { TagDialog } from "@/components/tags/TagDialog"
import { useDeleteTag, useTags } from "@/hooks/useTags"
import type { Tag } from "@/types/api"

export function TagsPage() {
  const { data, isLoading, isError, error } = useTags()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
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
        <div className="space-y-2">
          {data.map((tag) => (
            <TagRow key={tag.id} tag={tag} />
          ))}
        </div>
      )}
    </div>
  )
}

function TagRow({ tag }: { tag: Tag }) {
  const deleteTag = useDeleteTag()

  return (
    <div className="flex items-center gap-2 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
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
