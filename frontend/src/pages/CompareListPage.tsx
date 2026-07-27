import { useNavigate } from "react-router-dom"
import { Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CompareListTile } from "@/components/library/CompareListTile"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { useCompareList, useClearCompareList, useRemoveFromCompareList } from "@/hooks/useCompareList"
import { useIdSelection } from "@/hooks/useIdSelection"

const MAX_PLAYABLE = 6

export function CompareListPage() {
  const { data: items, isLoading, isError, error } = useCompareList()
  const { selected, isSelected, toggle, size } = useIdSelection()
  const removeFromCompareList = useRemoveFromCompareList()
  const clearCompareList = useClearCompareList()
  const navigate = useNavigate()

  const handlePlay = () => {
    navigate(`/compare-list/play?items=${[...selected].join(",")}`)
  }

  return (
    <RevealAllProvider>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Compare list</h1>
            <p className="text-sm text-muted-foreground">
              Pick up to {MAX_PLAYABLE} files to play side by side and compare.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {items && items.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={clearCompareList.isPending}
                onClick={() => clearCompareList.mutate()}
              >
                Clear list
              </Button>
            )}
            <Button size="sm" disabled={size === 0} onClick={handlePlay}>
              <Play className="h-4 w-4" />
              Play selected ({size}/{MAX_PLAYABLE})
            </Button>
          </div>
        </div>

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
    </RevealAllProvider>
  )
}
