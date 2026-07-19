import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { bulkDeleteTags, createTag, deleteTag, fetchTags, updateTag } from "@/lib/api"
import type { BulkDeleteRequest, CreateTagRequest, UpdateTagRequest } from "@/types/api"
import { libraryQueryKey } from "./useLibrary"

export const tagsQueryKey = ["tags"] as const

export function useTags() {
  return useQuery({
    queryKey: tagsQueryKey,
    queryFn: fetchTags,
  })
}

export function useCreateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateTagRequest) => createTag(payload),
    onSuccess: () => {
      toast.success("Tag created")
      // A brand new tag isn't attached to anything yet, so no library item's
      // rendering changes — no need to invalidate libraryQueryKey here.
      queryClient.invalidateQueries({ queryKey: tagsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to create tag: ${err.message}`)
    },
  })
}

export function useUpdateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateTagRequest }) => updateTag(id, payload),
    onSuccess: () => {
      toast.success("Tag saved")
      queryClient.invalidateQueries({ queryKey: tagsQueryKey })
      // Renaming changes the tag name shown on every library item's badges,
      // and toggling privacy changes whether those items render blurred.
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to save tag: ${err.message}`)
    },
  })
}

export function useDeleteTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteTag(id),
    onSuccess: () => {
      toast.success("Tag deleted")
      queryClient.invalidateQueries({ queryKey: tagsQueryKey })
      // Deleting removes the tag from every library item's badges/filter options.
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete tag: ${err.message}`)
    },
  })
}

export function useBulkDeleteTags() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: BulkDeleteRequest) => bulkDeleteTags(payload),
    onSuccess: (result) => {
      toast.success(`Deleted ${result.deleted} tag${result.deleted === 1 ? "" : "s"}`)
      queryClient.invalidateQueries({ queryKey: tagsQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete tags: ${err.message}`)
    },
  })
}
