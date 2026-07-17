import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { bulkDeleteArtists, createArtist, deleteArtist, fetchArtists, updateArtist } from "@/lib/api"
import type { BulkDeleteRequest, CreateArtistRequest, UpdateArtistRequest } from "@/types/api"
import { libraryQueryKey } from "./useLibrary"

export const artistsQueryKey = ["artists"] as const

export function useArtists() {
  return useQuery({
    queryKey: artistsQueryKey,
    queryFn: fetchArtists,
  })
}

export function useCreateArtist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateArtistRequest) => createArtist(payload),
    onSuccess: () => {
      toast.success("Artist created")
      // A brand new artist isn't attached to anything yet, so no library
      // item's rendering changes — no need to invalidate libraryQueryKey here.
      queryClient.invalidateQueries({ queryKey: artistsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to create artist: ${err.message}`)
    },
  })
}

export function useUpdateArtist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateArtistRequest }) => updateArtist(id, payload),
    onSuccess: () => {
      toast.success("Artist renamed")
      queryClient.invalidateQueries({ queryKey: artistsQueryKey })
      // Renaming changes the artist name shown on every library item.
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to rename artist: ${err.message}`)
    },
  })
}

export function useDeleteArtist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteArtist(id),
    onSuccess: () => {
      toast.success("Artist deleted")
      queryClient.invalidateQueries({ queryKey: artistsQueryKey })
      // Deleting clears the artist from every library item that had it.
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete artist: ${err.message}`)
    },
  })
}

export function useBulkDeleteArtists() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: BulkDeleteRequest) => bulkDeleteArtists(payload),
    onSuccess: (result) => {
      toast.success(`Deleted ${result.deleted} artist${result.deleted === 1 ? "" : "s"}`)
      queryClient.invalidateQueries({ queryKey: artistsQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete artists: ${err.message}`)
    },
  })
}
