import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  applyThumbnailFromGallery,
  deleteThumbnailGalleryImage,
  fetchThumbnailGallery,
  saveThumbnailToGallery,
  setThumbnailGalleryFavorite,
  urlToBase64,
} from "@/lib/api"
import { libraryQueryKey } from "./useLibrary"

export const thumbnailGalleryQueryKey = (libraryItemId: number) => ["thumbnail-gallery", libraryItemId] as const

// Gallery contents changed (image added/removed): refetch the gallery itself
// and the library list, whose cards show the item's gallery image count.
function invalidateGalleryCaches(queryClient: QueryClient, libraryItemId: number) {
  queryClient.invalidateQueries({ queryKey: thumbnailGalleryQueryKey(libraryItemId) })
  queryClient.invalidateQueries({ queryKey: libraryQueryKey })
}

// enabled defaults to true — false while the gallery dialog isn't open yet,
// same precedent as useLibraryItemMetadataPreview.
export function useThumbnailGallery(libraryItemId: number, enabled = true) {
  return useQuery({
    queryKey: thumbnailGalleryQueryKey(libraryItemId),
    queryFn: () => fetchThumbnailGallery(libraryItemId),
    enabled,
  })
}

export function useSaveThumbnailToGallery() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, imageBase64, timestampSeconds }: { id: number; imageBase64?: string; timestampSeconds?: number | null }) =>
      saveThumbnailToGallery(id, imageBase64, timestampSeconds),
    onSuccess: (_data, { id }) => {
      toast.success("Saved to gallery")
      invalidateGalleryCaches(queryClient, id)
    },
    onError: (err: Error) => toast.error(`Failed to save to gallery: ${err.message}`),
  })
}

// useSaveThumbnailsToGallery saves several already-extracted frames one
// request at a time through the same single-image endpoint, with one summary
// toast and one gallery refetch instead of one per frame. A frame that fails
// doesn't stop the rest; it only errors if none were saved.
export function useSaveThumbnailsToGallery() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, frames }: { id: number; frames: { imageBase64: string; timestampSeconds: number }[] }) => {
      let saved = 0
      let lastError = ""
      for (const frame of frames) {
        try {
          await saveThumbnailToGallery(id, frame.imageBase64, frame.timestampSeconds)
          saved++
        } catch (err) {
          lastError = (err as Error).message
        }
      }
      if (saved === 0) throw new Error(lastError || "no frames to save")
      return { saved, total: frames.length }
    },
    onSuccess: ({ saved, total }, { id }) => {
      toast.success(saved === total ? `Saved ${saved} frames to gallery` : `Saved ${saved} of ${total} frames to gallery`)
      invalidateGalleryCaches(queryClient, id)
    },
    onError: (err: Error, { id }) => {
      toast.error(`Failed to save to gallery: ${err.message}`)
      invalidateGalleryCaches(queryClient, id)
    },
  })
}

// useSaveThumbnailToGalleryFromUrl is for call sites that only have an
// already-rendered image's URL (a frame match result, an enhancement
// compare pair) rather than base64 in hand — it fetches the bytes itself
// before delegating to the same save endpoint.
export function useSaveThumbnailToGalleryFromUrl() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, url, timestampSeconds }: { id: number; url: string; timestampSeconds?: number | null }) =>
      saveThumbnailToGallery(id, await urlToBase64(url), timestampSeconds),
    onSuccess: (_data, { id }) => {
      toast.success("Saved to gallery")
      invalidateGalleryCaches(queryClient, id)
    },
    onError: (err: Error) => toast.error(`Failed to save to gallery: ${err.message}`),
  })
}

export function useSetThumbnailGalleryFavorite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, galleryId, isFavorite }: { id: number; galleryId: number; isFavorite: boolean }) =>
      setThumbnailGalleryFavorite(id, galleryId, isFavorite),
    onSuccess: (_data, { id }) => queryClient.invalidateQueries({ queryKey: thumbnailGalleryQueryKey(id) }),
    onError: (err: Error) => toast.error(`Failed to update favorite: ${err.message}`),
  })
}

// Bulk favorite/unfavorite for the gallery's manage mode. Like
// useSaveThumbnailsToGallery it loops the single-image endpoint — one summary
// toast and one refetch — and a failure doesn't stop the rest; it only errors
// if none succeeded.
export function useSetThumbnailGalleryFavorites() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, galleryIds, isFavorite }: { id: number; galleryIds: number[]; isFavorite: boolean }) => {
      let done = 0
      let lastError = ""
      for (const galleryId of galleryIds) {
        try {
          await setThumbnailGalleryFavorite(id, galleryId, isFavorite)
          done++
        } catch (err) {
          lastError = (err as Error).message
        }
      }
      if (done === 0) throw new Error(lastError || "nothing to update")
      return { done, total: galleryIds.length, isFavorite }
    },
    onSuccess: ({ done, total, isFavorite }, { id }) => {
      const verb = isFavorite ? "Added to favorites" : "Removed from favorites"
      toast.success(done === total ? `${verb}: ${done} image${done === 1 ? "" : "s"}` : `${verb}: ${done} of ${total} images`)
      queryClient.invalidateQueries({ queryKey: thumbnailGalleryQueryKey(id) })
    },
    onError: (err: Error, { id }) => {
      toast.error(`Failed to update favorites: ${err.message}`)
      queryClient.invalidateQueries({ queryKey: thumbnailGalleryQueryKey(id) })
    },
  })
}

export function useDeleteThumbnailGalleryImages() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, galleryIds }: { id: number; galleryIds: number[] }) => {
      let done = 0
      let lastError = ""
      for (const galleryId of galleryIds) {
        try {
          await deleteThumbnailGalleryImage(id, galleryId)
          done++
        } catch (err) {
          lastError = (err as Error).message
        }
      }
      if (done === 0) throw new Error(lastError || "nothing to remove")
      return { done, total: galleryIds.length }
    },
    onSuccess: ({ done, total }, { id }) => {
      toast.success(done === total ? `Removed ${done} image${done === 1 ? "" : "s"} from gallery` : `Removed ${done} of ${total} images from gallery`)
      invalidateGalleryCaches(queryClient, id)
    },
    onError: (err: Error, { id }) => {
      toast.error(`Failed to remove from gallery: ${err.message}`)
      invalidateGalleryCaches(queryClient, id)
    },
  })
}

export function useApplyThumbnailFromGallery() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, galleryId }: { id: number; galleryId: number }) => applyThumbnailFromGallery(id, galleryId),
    onSuccess: () => {
      toast.success("Thumbnail updated")
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
    onError: (err: Error) => toast.error(`Failed to set thumbnail: ${err.message}`),
  })
}

