import type { ThumbnailEnhancementStatus } from "@/types/api"

export type EnhancementStatusColor = "green" | "red" | "grey"

// Shared between the AI Enhancement page's status badge and the sidebar nav
// dot, so both always agree on what "active/not reachable/not configured"
// means.
export function enhancementStatusColor(
  status: ThumbnailEnhancementStatus | undefined,
  isLoading: boolean,
): EnhancementStatusColor {
  if (isLoading || !status || !status.configured) return "grey"
  return status.reachable ? "green" : "red"
}
