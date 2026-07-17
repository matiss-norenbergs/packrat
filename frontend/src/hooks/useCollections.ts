import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { bulkDeleteCollections, createCollection, deleteCollection, fetchCollections, updateCollection } from "@/lib/api"
import type { BulkDeleteRequest, CreateCollectionRequest, UpdateCollectionRequest } from "@/types/api"
import { downloadsQueryKey } from "./useDownloads"
import { libraryQueryKey } from "./useLibrary"

export const collectionsQueryKey = ["collections"] as const

export function useCollections() {
  return useQuery({
    queryKey: collectionsQueryKey,
    queryFn: fetchCollections,
  })
}

export function useCreateCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateCollectionRequest) => createCollection(payload),
    onSuccess: () => {
      toast.success("Collection created")
      queryClient.invalidateQueries({ queryKey: collectionsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to create collection: ${err.message}`)
    },
  })
}

export function useUpdateCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateCollectionRequest }) => updateCollection(id, payload),
    onSuccess: () => {
      toast.success("Collection updated")
      queryClient.invalidateQueries({ queryKey: collectionsQueryKey })
      // Library/Downloads cards display the collection name via a JOIN, so
      // a rename needs to be reflected there too.
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to update collection: ${err.message}`)
    },
  })
}

export function useDeleteCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteCollection(id),
    onSuccess: () => {
      toast.success("Collection deleted")
      queryClient.invalidateQueries({ queryKey: collectionsQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete collection: ${err.message}`)
    },
  })
}

export function useBulkDeleteCollections() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: BulkDeleteRequest) => bulkDeleteCollections(payload),
    onSuccess: (result) => {
      const skipped = result.skipped?.length ?? 0
      toast.success(
        `Deleted ${result.deleted} collection${result.deleted === 1 ? "" : "s"}` +
          (skipped > 0 ? `, skipped ${skipped} (still have sub-collections)` : ""),
      )
      queryClient.invalidateQueries({ queryKey: collectionsQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete collections: ${err.message}`)
    },
  })
}
