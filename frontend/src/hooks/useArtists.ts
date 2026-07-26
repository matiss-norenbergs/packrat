import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  addArtistImage,
  bulkDeleteArtists,
  clearArtistSelectedImage,
  createArtist,
  deleteArtist,
  deleteArtistImage,
  fetchArtistImageCandidates,
  fetchArtistImages,
  fetchArtists,
  selectArtistImage,
  updateArtist,
} from "@/lib/api"
import type { BulkDeleteRequest, CreateArtistRequest, SetArtistImageRequest, UpdateArtistRequest } from "@/types/api"
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

export function useArtistImages(artistId: number, enabled: boolean) {
  return useQuery({
    queryKey: ["artists", artistId, "images"],
    queryFn: () => fetchArtistImages(artistId),
    enabled,
  })
}

export function useArtistImageCandidates(artistId: number, enabled: boolean) {
  return useQuery({
    queryKey: ["artists", artistId, "image-candidates"],
    queryFn: () => fetchArtistImageCandidates(artistId),
    enabled,
  })
}

export function useAddArtistImage(artistId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: SetArtistImageRequest) => addArtistImage(artistId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artists", artistId, "images"] })
    },
    onError: (err: Error) => {
      toast.error(`Failed to add image: ${err.message}`)
    },
  })
}

export function useDeleteArtistImage(artistId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (imageId: number) => deleteArtistImage(artistId, imageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artists", artistId, "images"] })
      // A deleted selected image also clears artists.selectedImagePath
      // server-side — refresh the artist list so that shows up everywhere.
      queryClient.invalidateQueries({ queryKey: artistsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete image: ${err.message}`)
    },
  })
}

export function useSelectArtistImage(artistId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (imageId: number) => selectArtistImage(artistId, imageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: artistsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to select image: ${err.message}`)
    },
  })
}

export function useClearArtistSelectedImage(artistId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => clearArtistSelectedImage(artistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: artistsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Failed to clear selected image: ${err.message}`)
    },
  })
}
