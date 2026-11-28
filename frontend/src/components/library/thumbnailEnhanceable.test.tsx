import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, renderHook, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BulkSharpenThumbnailsDialog } from "@/components/library/BulkSharpenThumbnailsDialog"
import { mockFetch } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"
import { useLibraryItemActions, type LibraryItemAction } from "./libraryItemActions"
import { bulkSharpenAvailable } from "./thumbnailEnhanceable"
import { settleQueries } from "@/test/settle"

let items: LibraryItem[] = []
vi.mock("./SelectionContext", () => ({
  useSelection: () => ({ selectedItems: new Map(items.map((i) => [i.id, i])), selectedCollectionIds: new Set<number>(), clear: vi.fn() }),
}))
vi.mock("@/hooks/useCollections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCollections")>()),
  useCollections: () => ({ data: [] }),
}))
vi.mock("@/hooks/useLibrary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useLibrary")>()),
  useLibraryQuery: () => ({ data: undefined, isLoading: false }),
}))
vi.mock("./LibraryItemPreviewRow", () => ({ LibraryItemPreviewRow: ({ item }: { item: LibraryItem }) => <div>{item.title}</div> }))

beforeEach(() => {
  mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { thumbnailEnhancementEnabled: true, featureCompareListEnabled: true, featureFrameMatchingEnabled: true } }
    return { status: 200, body: [] }
  })
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})

const make = (over: Partial<LibraryItem>) =>
  ({ id: 1, title: "T", filename: "a.mp4", path: "m/a.mp4", mediaType: "video", status: "complete", originalUrl: "https://x/y", thumbnail: "t.jpg", tags: [], ...over }) as LibraryItem

function labels(list: LibraryItemAction[]): string[] {
  return list.flatMap((a) => ("separator" in a ? [] : "items" in a ? [a.label, ...labels(a.items)] : [a.label]))
}
async function menuLabels(item: LibraryItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useLibraryItemActions(item), { wrapper })
  // The settings query resolves asynchronously; wait until Sharpen is known for the video case.
  await waitFor(() => expect(result.current).toBeTruthy())
  await settleQueries(client)
  return labels(result.current.actionsFor(item))
}

describe("AI enhancement actions and image items", () => {
  it("the single-item Thumbnail submenu offers Sharpen for a video and audio item, never for an image item", async () => {
    expect(await menuLabels(make({ id: 1 }))).toContain("Sharpen Thumbnail…")
    expect(await menuLabels(make({ id: 2, filename: "a.mp3", mediaType: "audio" }))).toContain("Sharpen Thumbnail…")
    const image = await menuLabels(make({ id: 3, filename: "a.png", path: "m/a.png", mediaType: "image", thumbnail: "m/a.png" }))
    expect(image.filter((l) => /enhance|sharpen/i.test(l))).toEqual([])
  })

  it("the bulk menu entry is offered unless only image items are selected", () => {
    const img = make({ mediaType: "image" })
    const vid = make({ mediaType: "video" })
    expect(bulkSharpenAvailable([vid], 0)).toBe(true)
    expect(bulkSharpenAvailable([img, vid], 0)).toBe(true)
    expect(bulkSharpenAvailable([img], 0)).toBe(false)
    expect(bulkSharpenAvailable([img], 1)).toBe(true) // a collection may hold videos
    expect(bulkSharpenAvailable([], 0)).toBe(true)
  })

  it("the bulk Sharpen dialog leaves image items out of the affected list", async () => {
    items = [make({ id: 1, title: "A video" }), make({ id: 2, title: "A picture", mediaType: "image", filename: "p.png" })]
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BulkSharpenThumbnailsDialog open onOpenChange={() => {}} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText("A video")).toBeTruthy()
    expect(screen.queryByText("A picture")).toBeNull()
    expect(screen.getByText("Sharpen 1 item's thumbnail?")).toBeTruthy()
  })
})
