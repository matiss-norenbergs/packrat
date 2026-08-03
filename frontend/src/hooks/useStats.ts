import { useQuery } from "@tanstack/react-query"
import { fetchLibraryGrowth, fetchResolutionBreakdown, fetchStats } from "@/lib/api"

export const statsQueryKey = ["stats"] as const
export const libraryGrowthQueryKey = ["stats", "library-growth"] as const
export const resolutionBreakdownQueryKey = ["stats", "resolution-breakdown"] as const

export function useStats() {
  return useQuery({
    queryKey: statsQueryKey,
    queryFn: fetchStats,
    refetchInterval: 10_000, // Dashboard has no WS feed of its own — same safety-net poll as useDownloads
  })
}

// No refetchInterval — growth-over-time changes far less often than the
// live-polled stats above, a plain cache is enough.
export function useLibraryGrowth() {
  return useQuery({
    queryKey: libraryGrowthQueryKey,
    queryFn: fetchLibraryGrowth,
  })
}

// No refetchInterval — resolution mix shifts only as new items are added,
// same reasoning as useLibraryGrowth above.
export function useResolutionBreakdown() {
  return useQuery({
    queryKey: resolutionBreakdownQueryKey,
    queryFn: fetchResolutionBreakdown,
  })
}
