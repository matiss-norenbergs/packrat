import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { deleteStrayFiles, scanStrayFiles } from "@/lib/api"
import type { StrayFileRef } from "@/types/api"

// Report-only scan; the caller owns the result (the Settings row keeps it for
// its summary line and the review dialog).
export function useScanStrayFiles() {
  return useMutation({
    mutationFn: () => scanStrayFiles(),
    onError: (err: Error) => toast.error(`Scan failed: ${err.message}`),
  })
}

export function useDeleteStrayFiles() {
  return useMutation({
    mutationFn: (paths: StrayFileRef[]) => deleteStrayFiles(paths),
    onSuccess: (result) => {
      toast.success(
        result.skipped > 0
          ? `Deleted ${result.deleted} stray file(s), skipped ${result.skipped} no longer stray`
          : `Deleted ${result.deleted} stray file(s)`,
      )
    },
    onError: (err: Error) => toast.error(`Delete failed: ${err.message}`),
  })
}
