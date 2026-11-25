import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// A failed query's message with a Retry button — shown instead of the empty-state text, which would
// wrongly claim "nothing here" for a request that never succeeded. The button is at least 44 px high
// on touch devices (the Android app).
export function QueryErrorNotice({
  message,
  onRetry,
  className,
}: {
  message: string
  onRetry: () => void
  className?: string
}) {
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-3 text-sm text-destructive", className)}>
      <span>{message}</span>
      <Button variant="outline" size="sm" className="pointer-coarse:min-h-11" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </Button>
    </div>
  )
}
