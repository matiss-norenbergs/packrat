import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { createImport, fetchImportScan } from "@/lib/api"
import type { ImportRequest } from "@/types/api"
import { libraryQueryKey } from "./useLibrary"
import { collectionsQueryKey } from "./useCollections"

export const importScanQueryKey = ["import", "scan"] as const

export function useImportScan() {
  return useQuery({
    queryKey: importScanQueryKey,
    queryFn: fetchImportScan,
  })
}

export function useCreateImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: ImportRequest) => createImport(payload),
    onSuccess: () => {
      toast.success("File imported")
      queryClient.invalidateQueries({ queryKey: importScanQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: collectionsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to import: ${err.message}`)
    },
  })
}
