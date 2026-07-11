import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  deleteLibraryItem,
  deleteLibraryItemNFO,
  fetchLibrary,
  fetchLibraryItemNFO,
  fetchLibraryThumbnailCandidates,
  generateLibraryItemNFO,
  moveLibraryItem,
  quickGrabLibraryThumbnail,
  redownloadLibraryItem,
  redownloadLibraryThumbnail,
  refreshLibraryItemMetadata,
  setLibraryThumbnail,
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

export function useRedownloadLibraryThumbnail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => redownloadLibraryThumbnail(id),
    onSuccess: () => {
      toast.success("Thumbnail redownloaded")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to redownload thumbnail: ${err.message}`),
  })
}

export function useQuickGrabLibraryThumbnail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => quickGrabLibraryThumbnail(id),
    onSuccess: () => {
      toast.success("Thumbnail grabbed")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to grab thumbnail: ${err.message}`),
  })
}

export function useLibraryThumbnailCandidates(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ["library", id, "thumbnail-candidates"],
    queryFn: () => fetchLibraryThumbnailCandidates(id),
    enabled,
    staleTime: 0,
    gcTime: 0,
  })
}

export function useGenerateLibraryItemNFO() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => generateLibraryItemNFO(id),
    onSuccess: (_data, id) => {
      toast.success("NFO file generated")
      // nfoExists on the library list is now stale, and the content dialog
      // (if it's ever reopened) shouldn't serve a cached pre-generation
      // 404/old body.
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: ["library", id, "nfo"] })
    },
    onError: (err: Error) => toast.error(`Failed to generate NFO: ${err.message}`),
  })
}

export function useLibraryItemNFO(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ["library", id, "nfo"],
    queryFn: () => fetchLibraryItemNFO(id),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

export function useDeleteLibraryItemNFO() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteLibraryItemNFO(id),
    onSuccess: (_data, id) => {
      toast.success("NFO file deleted")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: ["library", id, "nfo"] })
    },
    onError: (err: Error) => toast.error(`Failed to delete NFO file: ${err.message}`),
  })
}

export function useSetLibraryThumbnail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, imageBase64 }: { id: number; imageBase64: string }) => setLibraryThumbnail(id, imageBase64),
    onSuccess: () => {
      toast.success("Thumbnail updated")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to set thumbnail: ${err.message}`),
  })
}
