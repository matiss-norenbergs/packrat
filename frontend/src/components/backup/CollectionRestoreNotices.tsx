import { InfoIcon, TriangleAlertIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { matchedByNameLines, plural, unresolvedLines } from "@/lib/backupCollections"
import type { CollectionMatch, CollectionNameKept, UnresolvedCollection } from "@/types/api"

interface CollectionRestoreNoticesProps {
  // How many collections are matched by display name (the count the server reports; `matches`
  // may be absent in a preview, which only carries the per-entry flags).
  matchedByNameCount?: number
  matched?: CollectionMatch[] | null
  unresolved?: UnresolvedCollection[] | null
  nameKept?: CollectionNameKept[] | null
}

// Shared by the library and full-backup import previews: an info line when collections are matched
// by name (a renamed folder), and a warning listing collections that cannot be restored. Renders
// nothing when there is nothing to say.
export function CollectionRestoreNotices({
  matchedByNameCount = 0,
  matched,
  unresolved,
  nameKept,
}: CollectionRestoreNoticesProps) {
  const matchedLines = matchedByNameLines(matched)
  const unresolvedList = unresolved ?? []
  const keptList = nameKept ?? []
  if (matchedByNameCount === 0 && unresolvedList.length === 0 && keptList.length === 0) return null

  return (
    <div className="space-y-2 text-sm">
      {matchedByNameCount > 0 && (
        <div className="flex items-start gap-2 rounded-md border p-2 text-muted-foreground" data-testid="matched-by-name">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p>
              {plural(matchedByNameCount, "collection")} will use an existing collection with the same name (its folder was renamed
              after the backup). Existing collections are never modified.
            </p>
            {matchedLines.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {matchedLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {keptList.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border p-2 text-muted-foreground" data-testid="name-kept">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            {plural(keptList.length, "new collection")} will be named after {keptList.length === 1 ? "its" : "their"} folder because the
            backup&apos;s name is already used: {keptList.map((k) => `${k.wantedName} → ${k.keptName}`).join(", ")}.
          </p>
        </div>
      )}
      {unresolvedList.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-warning-text" role="alert" data-testid="unresolved-collections">
          <div className="flex items-center gap-2">
            <TriangleAlertIcon className="size-4 shrink-0" />
            <Badge variant="warning">{plural(unresolvedList.length, "collection")} can&apos;t be restored</Badge>
          </div>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {unresolvedLines(unresolvedList).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
