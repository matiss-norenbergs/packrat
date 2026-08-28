import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Eye, EyeOff, Play, Trash2 } from "lucide-react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CompareListTile } from "@/components/library/CompareListTile"
import { RevealAllProvider, useRevealAll } from "@/components/library/RevealAllContext"
import { useCompareList, useClearCompareList, useRemoveFromCompareList } from "@/hooks/useCompareList"
import { useIdSelection } from "@/hooks/useIdSelection"

const MAX_PLAYABLE = 6

// Wraps the actual content in RevealAllProvider — the reveal-all button
// below needs useRevealAll(), which only works from a descendant of the
// provider, not the same component that creates it.
export function CompareListPage() {
  return (
    <RevealAllProvider>
      <CompareListPageContent />
    </RevealAllProvider>
  )
}

function CompareListPageContent() {
  const { data: items, isLoading, isError, error } = useCompareList()
  const { selected, isSelected, toggle, size } = useIdSelection()
  const removeFromCompareList = useRemoveFromCompareList()
  const clearCompareList = useClearCompareList()
  const { revealAll, toggleRevealAll } = useRevealAll()
  const navigate = useNavigate()
  const [clearOpen, setClearOpen] = useState(false)

  const hasBlurred = (items ?? []).some((item) => item.blurred)

  const handlePlay = () => {
    navigate(`/compare-list/play?items=${[...selected].join(",")}`)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold">Compare list</h1>
        <p className="text-sm text-muted-foreground">
          Pick up to {MAX_PLAYABLE} files to play side by side and compare.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" disabled={size === 0} onClick={handlePlay}>
          <Play className="h-4 w-4" />
          Play selected ({size}/{MAX_PLAYABLE})
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!items || items.length === 0 || clearCompareList.isPending}
          onClick={() => setClearOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Clear list
        </Button>
        <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear the compare list?</AlertDialogTitle>
              <AlertDialogDescription>
                Removes all {items?.length ?? 0} {items?.length === 1 ? "item" : "items"} from your compare list.
                Your library files are unaffected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  clearCompareList.mutate()
                  setClearOpen(false)
                }}
              >
                Clear list
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={revealAll ? "secondary" : "outline"} size="icon" disabled={!hasBlurred} onClick={toggleRevealAll}>
              {revealAll ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{revealAll ? "Hide all private items" : "Reveal all private items"}</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Failed to load compare list: {(error as Error).message}</p>
        ) : !items || items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing here yet — add files from the Library page's bulk operations, or from a file's own page.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <CompareListTile
                key={item.id}
                item={item}
                selected={isSelected(item.id)}
                canSelect={size < MAX_PLAYABLE}
                onToggle={() => toggle(item.id)}
                onRemove={() => removeFromCompareList.mutate(item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
