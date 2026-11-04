import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mockFetch } from "@/test/mockApi"
import { skippedDownloadingNote, withSkippedNote } from "@/lib/bulkSkipped"
import { useBulkStartFrameMatch } from "./useFrameMatchQueue"
import {
  useBulkAssignTags,
  useBulkDeleteLibraryItemFiles,
  useBulkFetchLibraryThumbnails,
  useBulkRedownloadLibraryItems,
} from "./useLibrary"

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

async function run<T>(hook: () => { mutate: (v: T) => void }, body: unknown, variables: T) {
  mockFetch(() => ({ status: 200, body }))
  const { result } = renderHook(hook, { wrapper })
  await act(async () => result.current.mutate(variables))
}

describe("bulk actions report items skipped for an active download", () => {
  it("formats the note", () => {
    expect(skippedDownloadingNote(0)).toBe("")
    expect(skippedDownloadingNote(3)).toBe("3 skipped, download in progress")
    expect(withSkippedNote("Done", 0)).toBe("Done")
    expect(withSkippedNote("Done", 3)).toBe("Done (3 skipped, download in progress)")
  })

  it("bulk tags", async () => {
    await run(useBulkAssignTags, { updated: 2, skipped: 3, skippedDownloading: 3 }, { itemIds: [1, 2, 3, 4, 5], tags: ["a"] })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Tags updated on 2 files (3 skipped, download in progress)"))
  })

  it("bulk tags when everything was skipped", async () => {
    await run(useBulkAssignTags, { updated: 0, skipped: 1, skippedDownloading: 1 }, { itemIds: [1], tags: ["a"] })
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("No tags updated (1 skipped, download in progress)"))
  })

  it("delete files", async () => {
    await run(useBulkDeleteLibraryItemFiles, { deleted: 1, skipped: 1, skippedDownloading: 1 }, { itemIds: [1, 2], deleteThumbnail: false })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Deleted 1 file (1 skipped, download in progress)"))
  })

  it("redownload", async () => {
    await run(useBulkRedownloadLibraryItems, { queued: 2, skipped: 1, skippedDownloading: 1 }, { itemIds: [1, 2, 3] })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Queued 2 downloads (1 skipped, download in progress)"))
  })

  it("fetch thumbnails", async () => {
    await run(useBulkFetchLibraryThumbnails, { fetched: 1, skipped: 2, skippedDownloading: 2 }, { itemIds: [1, 2, 3] })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Fetched 1 thumbnail (2 skipped, download in progress)"))
  })

  it("frame matching separates ineligible from downloading", async () => {
    await run(useBulkStartFrameMatch, { queued: 1, skipped: 3, skippedDownloading: 2, alreadyQueued: 0 }, { itemIds: [1, 2, 3, 4], mode: "url" as const })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Queued 1 item(s) for matching, skipped 1 ineligible, 2 skipped, download in progress"))
  })

  it("stays quiet when nothing was skipped", async () => {
    await run(useBulkRedownloadLibraryItems, { queued: 1, skipped: 0, skippedDownloading: 0 }, { itemIds: [1] })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Queued 1 download"))
  })
})
