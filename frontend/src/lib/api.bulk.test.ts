import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ApiError,
  MAX_BULK_ITEMS,
  bulkAddSubscriptionEntries,
  bulkDeleteBackups,
  bulkDeleteDownloads,
  bulkDeleteGalleryImages,
  bulkDeleteHistory,
  bulkDeleteSubscriptions,
  bulkMarkSubscriptionEntriesSeen,
  bulkRetryHistory,
  bulkSetGalleryFavorites,
  bulkUnlinkSubscriptionEntries,
  bulkUpdateLibraryItems,
} from "@/lib/api"
import { bodyOf, callsTo, mockFetch } from "@/test/mockApi"

afterEach(() => vi.unstubAllGlobals())

const ok = (body: unknown) => ({ status: 200, body })

describe("bulk API functions: one POST per call, JSON body, no old single-item URLs", () => {
  it("all-or-nothing deletes and updates post the list in one request", async () => {
    const fetchMock = mockFetch(() => ok({ deleted: 1, updated: 1 }))
    await bulkDeleteDownloads([1, 2])
    await bulkDeleteHistory([3])
    await bulkDeleteSubscriptions([4])
    await bulkDeleteBackups([5])
    await bulkDeleteGalleryImages(9, [6, 7])
    await bulkSetGalleryFavorites(9, [6], true)
    await bulkMarkSubscriptionEntriesSeen(2, ["a/b", "c"])
    await bulkUnlinkSubscriptionEntries(2, ["a"])

    const seen = fetchMock.mock.calls.map(([url, init]) => [url.replace(/^.*\/api/, ""), (init as RequestInit).method, JSON.parse((init as RequestInit).body as string)])
    expect(seen).toEqual([
      ["/downloads/bulk-delete", "POST", { ids: [1, 2] }],
      ["/history/bulk-delete", "POST", { ids: [3] }],
      ["/subscriptions/bulk-delete", "POST", { ids: [4] }],
      ["/backup/history/bulk-delete", "POST", { ids: [5] }],
      ["/library/9/thumbnail/gallery/bulk-delete", "POST", { galleryIds: [6, 7] }],
      ["/library/9/thumbnail/gallery/bulk-favorite", "POST", { galleryIds: [6], isFavorite: true }],
      // Source ids travel in the body, so slashes in them need no path encoding.
      ["/subscriptions/2/entries/bulk-seen", "POST", { sourceIds: ["a/b", "c"] }],
      ["/subscriptions/2/entries/bulk-unlink", "POST", { sourceIds: ["a"] }],
    ])
  })

  it("per-entry endpoints post the entries with their payload", async () => {
    const fetchMock = mockFetch((url) =>
      ok({ results: [{ id: 1, ok: true }], succeeded: 1, failed: 0, _url: url }),
    )
    await bulkUpdateLibraryItems([{ id: 1, changes: { year: 2000 } }])
    await bulkRetryHistory([1])
    await bulkAddSubscriptionEntries(7, ["x"], "ghost")
    expect(bodyOf(callsTo(fetchMock, "/library/bulk-update")[0])).toEqual({ items: [{ id: 1, changes: { year: 2000 } }] })
    expect(bodyOf(callsTo(fetchMock, "/history/bulk-retry")[0])).toEqual({ ids: [1] })
    expect(bodyOf(callsTo(fetchMock, "/subscriptions/7/entries/bulk-add")[0])).toEqual({ sourceIds: ["x"], mode: "ghost" })
  })

  it("a per-entry list over the cap is sent as several requests and the results are joined in order", async () => {
    const fetchMock = mockFetch((_url, init) => {
      const { items } = JSON.parse(init.body as string) as { items: { id: number }[] }
      return ok({ results: items.map((i) => ({ id: i.id, ok: true })), succeeded: items.length, failed: 0 })
    })
    const items = Array.from({ length: 2 * MAX_BULK_ITEMS + 5 }, (_, i) => ({ id: i + 1, changes: {} }))
    const res = await bulkUpdateLibraryItems(items)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).items.length)).toEqual([1000, 1000, 5])
    expect(res.succeeded).toBe(2005)
    expect(res.results.map((r) => r.id)).toEqual(items.map((i) => i.id))
  })

  it("an all-or-nothing delete over the cap is NOT split (that would break atomicity)", async () => {
    const fetchMock = mockFetch(() => ({ status: 400, body: { error: "too many entries: at most 1000 per request" } }))
    const ids = Array.from({ length: MAX_BULK_ITEMS + 1 }, (_, i) => i + 1)
    await expect(bulkDeleteHistory(ids)).rejects.toThrow("too many entries")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a 409 keeps the server message and the blocked ids on the ApiError", async () => {
    mockFetch(() => ({ status: 409, body: { error: "cancel these downloads before deleting them", blockedIds: [4, 5] } }))
    const err = await bulkDeleteDownloads([3, 4, 5]).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.message).toBe("cancel these downloads before deleting them")
    expect(err.body).toEqual({ error: "cancel these downloads before deleting them", blockedIds: [4, 5] })
  })
})
