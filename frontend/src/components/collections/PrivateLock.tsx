import { Lock } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSettings } from "@/hooks/useSettings"
import { nearestPrivateAncestor } from "@/lib/collectionTree"
import { cn } from "@/lib/utils"
import type { Collection } from "@/types/api"

/**
 * Lock marker for a collection: primary for an own Private flag, muted (with a
 * tooltip naming the ancestor) when privacy is only inherited. Renders nothing
 * with privacy off or for a non-private collection.
 */
export function PrivateLock({
  collection,
  collections,
  className,
}: {
  collection: Pick<Collection, "id" | "isPrivate" | "effectiveIsPrivate">
  collections: Collection[] | undefined
  /** Icon size classes, e.g. "h-3.5 w-3.5". */
  className?: string
}) {
  const { data: settings } = useSettings()
  if (!settings?.privacyEnabled) return null
  const inheritedOnly = !collection.isPrivate && collection.effectiveIsPrivate
  if (!collection.isPrivate && !inheritedOnly) return null

  const ancestor = inheritedOnly ? nearestPrivateAncestor(collections ?? [], collection.id) : null
  const label = !inheritedOnly
    ? "Private"
    : ancestor
      ? `Inherited from ${ancestor.name}`
      : "Inherited from a private parent"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0">
          <Lock
            aria-label={inheritedOnly ? "Inherited private" : "Private"}
            className={cn(className, inheritedOnly ? "text-muted-foreground" : "text-primary")}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
