import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { createCollection, deleteCollection, fetchCollections, updateCollection } from "@/lib/api"
import type { CreateCollectionRequest, UpdateCollectionRequest } from "@/types/api"
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
