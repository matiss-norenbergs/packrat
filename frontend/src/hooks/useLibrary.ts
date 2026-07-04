import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  deleteLibraryItem,
  fetchLibrary,
  moveLibraryItem,
  redownloadLibraryItem,
  refreshLibraryItemMetadata,
  updateLibraryItem,
} from "@/lib/api"
import type { MoveLibraryItemRequest, UpdateLibraryItemRequest } from "@/types/api"
import { downloadsQueryKey } from "./useDownloads"

export const libraryQueryKey = ["library"] as const

export function useLibrary() {
  return useQuery({
    queryKey: libraryQueryKey,
    queryFn: fetchLibrary,
  })
}

export function useDeleteLibraryItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, deleteFiles }: { id: number; deleteFiles: boolean }) => deleteLibraryItem(id, deleteFiles),
    onSuccess: () => {
      toast.success("Removed from library")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to delete: ${err.message}`),
  })
}

export function useUpdateLibraryItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateLibraryItemRequest }) => updateLibraryItem(id, payload),
    onSuccess: () => {
      toast.success("Saved")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to save: ${err.message}`),
  })
}

export function useMoveLibraryItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: MoveLibraryItemRequest }) => moveLibraryItem(id, payload),
    onSuccess: () => {
      toast.success("Moved")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to move: ${err.message}`),
  })
}

export function useRefreshLibraryItemMetadata() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => refreshLibraryItemMetadata(id),
    onSuccess: () => {
      toast.success("Metadata refreshed")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to refresh metadata: ${err.message}`),
  })
}

export function useRedownloadLibraryItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => redownloadLibraryItem(id),
    onSuccess: () => {
      toast.success("Redownload queued")
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to redownload: ${err.message}`),
  })
}
