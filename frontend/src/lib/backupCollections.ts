import type { BackupImportLibraryResult, CollectionMatch, UnresolvedCollection } from "@/types/api"
import { toast } from "sonner"

const chain = (path: string[]) => path.join(" / ")
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// One line per collection matched by display name: "concerts → live".
export function matchedByNameLines(matches: CollectionMatch[] | null | undefined): string[] {
  return (matches ?? []).map((m) => `${chain(m.path)} → ${chain(m.existingPath)}`)
}

export function unresolvedLines(list: UnresolvedCollection[] | null | undefined): string[] {
  return (list ?? []).map(
    (u) => `${chain(u.path)}: ${u.reason}${u.items > 0 ? ` (${plural(u.items, "item")} uncategorized)` : ""}`,
  )
}

// Tells the user what a library restore did with collections beyond the plain counts: an info toast
// when collections were matched by display name, and a warning toast (kept longer) listing the
// collections that could not be matched or created. Nothing is shown for a clean restore, and a
// result from an older server (no such fields) is a clean restore.
export function notifyCollectionRestore(result: BackupImportLibraryResult) {
  const matched = result.matchedByName ?? []
  if (matched.length > 0) {
    toast.info(`${plural(matched.length, "collection")} matched by name (folder was renamed)`, {
      description: matchedByNameLines(matched).join("; "),
    })
  }
  const unresolved = result.unresolvedCollections ?? []
  if (unresolved.length > 0) {
    toast.warning(`${plural(unresolved.length, "collection")} could not be restored`, {
      description: unresolvedLines(unresolved).join("; "),
      duration: 20000,
    })
  }
}
