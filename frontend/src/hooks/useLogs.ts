import { useQuery } from "@tanstack/react-query"
import { fetchLogs } from "@/lib/api"

export const logsQueryKey = ["logs"] as const

export function useLogs() {
  return useQuery({
    queryKey: logsQueryKey,
    queryFn: fetchLogs,
  })
}
