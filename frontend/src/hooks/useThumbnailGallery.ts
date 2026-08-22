import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { applyThumbnailFromGallery, deleteThumbnailGalleryImage, fetchThumbnailGallery, saveThumbnailToGallery, urlToBase64 } from "@/lib/api"
import { libraryQueryKey } from "./useLibrary"

export const thumbnailGalleryQueryKey = (libraryItemId: number) => ["thumbnail-gallery", libraryItemId] as const

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
    mutationFn: ({ id, imageBase64 }: { id: number; imageBase64?: string }) => saveThumbnailToGallery(id, imageBase64),
    onSuccess: (_data, { id }) => {
      toast.success("Saved to gallery")
      queryClient.invalidateQueries({ queryKey: thumbnailGalleryQueryKey(id) })
    },
    onError: (err: Error) => toast.error(`Failed to save to gallery: ${err.message}`),
  })
}

// useSaveThumbnailToGalleryFromUrl is for call sites that only have an
// already-rendered image's URL (a frame match result, an enhancement
// compare pair) rather than base64 in hand — it fetches the bytes itself
// before delegating to the same save endpoint.
export function useSaveThumbnailToGalleryFromUrl() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, url }: { id: number; url: string }) => saveThumbnailToGallery(id, await urlToBase64(url)),
    onSuccess: (_data, { id }) => {
      toast.success("Saved to gallery")
      queryClient.invalidateQueries({ queryKey: thumbnailGalleryQueryKey(id) })
    },
    onError: (err: Error) => toast.error(`Failed to save to gallery: ${err.message}`),
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

export function useDeleteThumbnailGalleryImage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, galleryId }: { id: number; galleryId: number }) => deleteThumbnailGalleryImage(id, galleryId),
    onSuccess: (_data, { id }) => {
      toast.success("Removed from gallery")
      queryClient.invalidateQueries({ queryKey: thumbnailGalleryQueryKey(id) })
    },
    onError: (err: Error) => toast.error(`Failed to remove from gallery: ${err.message}`),
  })
}
