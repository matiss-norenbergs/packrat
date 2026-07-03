import { useQuery } from "@tanstack/react-query"
import { fetchLibrary } from "@/lib/api"

export const libraryQueryKey = ["library"] as const

export function useLibrary() {
  return useQuery({
    queryKey: libraryQueryKey,
    queryFn: fetchLibrary,
  })
}
