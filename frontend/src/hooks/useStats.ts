import { useQuery } from "@tanstack/react-query"
import { fetchStats } from "@/lib/api"

export const statsQueryKey = ["stats"] as const

export function useStats() {
  return useQuery({
    queryKey: statsQueryKey,
    queryFn: fetchStats,
    refetchInterval: 10_000, // Dashboard has no WS feed of its own — same safety-net poll as useDownloads
  })
}
