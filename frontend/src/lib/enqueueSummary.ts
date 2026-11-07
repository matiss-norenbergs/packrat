import type { SkippedItem } from "@/types/api"

// Toast fragments for the skipped part of an enqueue result. A skipped entry
// is either a library duplicate ("in_library", or no reason at all from an
// older server) or a repeat of another entry in the same request
// ("duplicate_in_batch", which has no library item).
export function skippedSummaryParts(skipped: SkippedItem[]): string[] {
  const inBatch = skipped.filter((s) => s.reason === "duplicate_in_batch").length
  const inLibrary = skipped.length - inBatch
  const parts: string[] = []
  if (inLibrary > 0) parts.push(`${inLibrary} already in library`)
  if (inBatch > 0) parts.push(`${inBatch} duplicate in this batch`)
  return parts
}
