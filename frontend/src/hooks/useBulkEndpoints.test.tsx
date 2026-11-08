import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { bodyOf, callsTo, mockFetch } from "@/test/mockApi"
import { useBulkDeleteDownloads } from "./useDownloads"
import { useBulkRetryHistoryItems } from "./useHistory"
import { useUpdateLibraryItem } from "./useLibrary"
import { useBulkAddSubscriptionEntries, useBulkDeleteSubscriptions } from "./useSubscriptions"
import { useDeleteThumbnailGalleryImages, useSetThumbnailGalleryFavorite, useSetThumbnailGalleryFavorites } from "./useThumbnailGallery"

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider>
)
beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("single-item edit goes through the bulk endpoint with one element", () => {
  it("sends {items:[{id, changes}]} and toasts Saved", async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: { results: [{ id: 5, ok: true }], succeeded: 1, failed: 0 } }))
    const { result } = renderHook(useUpdateLibraryItem, { wrapper })
    await act(async () => result.current.mutate({ id: 5, payload: { title: "T", artistId: 0 } }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved"))
    expect(callsTo(fetchMock, "/library/bulk-update")).toHaveLength(1)
    expect(bodyOf(callsTo(fetchMock, "/library/bulk-update")[0])).toEqual({ items: [{ id: 5, changes: { title: "T", artistId: 0 } }] })
  })

  it("shows the item's own error (HTTP 200 with ok:false) as a failed save", async () => {
    mockFetch(() => ({
      status: 200,
      body: { results: [{ id: 5, ok: false, status: 409, error: "This item is being updated. Try again in a moment." }], succeeded: 0, failed: 1 },
    }))
    const { result } = renderHook(useUpdateLibraryItem, { wrapper })
    await act(async () => result.current.mutate({ id: 5, payload: { filename: "x" } }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to save: This item is being updated. Try again in a moment."))
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe("all-or-nothing deletes", () => {
  it("downloads: one request, one count toast", async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: { deleted: 2 } }))
    const { result } = renderHook(useBulkDeleteDownloads, { wrapper })
    await act(async () => result.current.mutate([1, 2]))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Removed 2 downloads"))
    expect(bodyOf(callsTo(fetchMock, "/downloads/bulk-delete")[0])).toEqual({ ids: [1, 2] })
  })

  it("downloads: a one-element list for a single row", async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: { deleted: 1 } }))
    const { result } = renderHook(useBulkDeleteDownloads, { wrapper })
    await act(async () => result.current.mutate([9]))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Removed 1 download"))
    expect(bodyOf(callsTo(fetchMock, "/downloads/bulk-delete")[0])).toEqual({ ids: [9] })
  })

  it("downloads: a 409 shows the server message, no success toast, and the caller's onSuccess (selection clear) never runs", async () => {
    mockFetch(() => ({ status: 409, body: { error: "cancel these downloads before deleting them", blockedIds: [2] } }))
    const onSuccess = vi.fn()
    const { result } = renderHook(useBulkDeleteDownloads, { wrapper })
    await act(async () => result.current.mutate([1, 2], { onSuccess }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to delete: cancel these downloads before deleting them"))
    expect(toast.success).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("subscriptions: one request", async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: { deleted: 2 } }))
    const { result } = renderHook(useBulkDeleteSubscriptions, { wrapper })
    await act(async () => result.current.mutate([1, 2]))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Removed 2 subscriptions"))
    expect(callsTo(fetchMock, "/subscriptions/bulk-delete")).toHaveLength(1)
  })

  it("gallery: favorite and delete are one request each, with counts from the server", async () => {
    const fetchMock = mockFetch((url) => (url.endsWith("bulk-favorite") ? { status: 200, body: { updated: 3 } } : { status: 200, body: { deleted: 2 } }))
    const fav = renderHook(useSetThumbnailGalleryFavorites, { wrapper })
    await act(async () => fav.result.current.mutate({ id: 4, galleryIds: [1, 2, 3], isFavorite: true }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Added to favorites: 3 images"))
    const del = renderHook(useDeleteThumbnailGalleryImages, { wrapper })
    await act(async () => del.result.current.mutate({ id: 4, galleryIds: [1, 2] }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Removed 2 images from gallery"))
    expect(bodyOf(callsTo(fetchMock, "/library/4/thumbnail/gallery/bulk-favorite")[0])).toEqual({ galleryIds: [1, 2, 3], isFavorite: true })
    expect(bodyOf(callsTo(fetchMock, "/library/4/thumbnail/gallery/bulk-delete")[0])).toEqual({ galleryIds: [1, 2] })
  })

  it("gallery: a single favorite sends a one-element list; a 400 shows the server message", async () => {
    const fetchMock = mockFetch(() => ({ status: 400, body: { error: "gallery images do not belong to this item", invalidIds: [8] } }))
    const { result } = renderHook(useSetThumbnailGalleryFavorite, { wrapper })
    await act(async () => result.current.mutate({ id: 4, galleryId: 8, isFavorite: false }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to update favorite: gallery images do not belong to this item"))
    expect(bodyOf(callsTo(fetchMock, "/library/4/thumbnail/gallery/bulk-favorite")[0])).toEqual({ galleryIds: [8], isFavorite: false })
  })
})

describe("per-item results feed the existing success / failure toasts", () => {
  it("history retry: succeeded and failed counts, first server message", async () => {
    mockFetch(() => ({
      status: 200,
      body: {
        results: [
          { id: 1, ok: true, downloadId: 10 },
          { id: 2, ok: false, status: 404, error: "history entry not found" },
          { id: 3, ok: true, downloadId: 11 },
        ],
        succeeded: 2,
        failed: 1,
      },
    }))
    const { result } = renderHook(useBulkRetryHistoryItems, { wrapper })
    await act(async () => result.current.mutate([1, 2, 3]))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("2 retries queued"))
    expect(toast.error).toHaveBeenCalledWith("1 retry failed: history entry not found")
  })

  it("history retry: a single id reads '1 retry queued'", async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: { results: [{ id: 1, ok: true, downloadId: 10 }], succeeded: 1, failed: 0 } }))
    const { result } = renderHook(useBulkRetryHistoryItems, { wrapper })
    await act(async () => result.current.mutate([1]))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("1 retry queued"))
    expect(toast.error).not.toHaveBeenCalled()
    expect(bodyOf(callsTo(fetchMock, "/history/bulk-retry")[0])).toEqual({ ids: [1] })
  })

  it("subscription entries bulk-add: added count plus a failure toast", async () => {
    mockFetch(() => ({
      status: 200,
      body: {
        results: [
          { id: "a", ok: true, libraryItemId: 3 },
          { id: "b", ok: false, status: 502, error: "adding as ghost item failed: x" },
        ],
        succeeded: 1,
        failed: 1,
      },
    }))
    const { result } = renderHook(useBulkAddSubscriptionEntries, { wrapper })
    await act(async () => result.current.mutate({ subscriptionId: 2, sourceIds: ["a", "b"], mode: "ghost" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Added 1 item"))
    expect(toast.error).toHaveBeenCalledWith("1 item failed: adding as ghost item failed: x")
  })
})
