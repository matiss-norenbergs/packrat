import { bulkUpdateLibraryItems } from "@/lib/api"
import type { BulkUpdateLibraryItem } from "@/types/api"

// Runs one POST /library/bulk-update for a bulk-edit dialog and reduces the per-item results to
// the two counts its "Updated N / N failed" toasts use. If the request itself fails (network
// down, 400) nothing was applied, so every entry counts as failed.
export async function runBulkLibraryUpdate(items: BulkUpdateLibraryItem[]): Promise<{ succeeded: number; failed: number }> {
  if (items.length === 0) return { succeeded: 0, failed: 0 }
  try {
    const { succeeded, failed } = await bulkUpdateLibraryItems(items)
    return { succeeded, failed }
  } catch {
    return { succeeded: 0, failed: items.length }
  }
}
