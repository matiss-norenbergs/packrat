import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BulkSetYearDialog } from "@/components/library/BulkSetYearDialog"
import { bodyOf, callsTo, mockFetch } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const clear = vi.fn()
let items: LibraryItem[] = []
vi.mock("./SelectionContext", () => ({
  useSelection: () => ({ selectedItems: new Map(items.map((i) => [i.id, i])), selectedCollectionIds: new Set<number>(), clear }),
}))
vi.mock("@/hooks/useCollections", () => ({ useCollections: () => ({ data: [] }) }))
vi.mock("@/hooks/useLibrary", () => ({
  libraryQueryKey: ["library"],
  useLibraryQuery: () => ({ data: undefined, isLoading: false }),
}))
vi.mock("./LibraryItemPreviewRow", () => ({ LibraryItemPreviewRow: ({ item }: { item: LibraryItem }) => <div>{item.title}</div> }))

const item = (id: number, over: Partial<LibraryItem> = {}) => ({ id, title: `Item ${id}`, activeDownloadId: null, ...over }) as LibraryItem

beforeEach(() => {
  vi.clearAllMocks()
  clear.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderDialog() {
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BulkSetYearDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  return onOpenChange
}

describe("BulkSetYearDialog saves through POST /library/bulk-update", () => {
  it("sends every editable item in ONE request, leaves out the one downloading, and reports counts", async () => {
    items = [item(1), item(2), item(3, { activeDownloadId: 77 })]
    const fetchMock = mockFetch(() => ({
      status: 200,
      body: { results: [{ id: 1, ok: true }, { id: 2, ok: false, status: 409, error: "busy" }], succeeded: 1, failed: 1 },
    }))
    const onOpenChange = renderDialog()
    await userEvent.type(screen.getByRole("spinbutton"), "1999")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(callsTo(fetchMock, "/library/bulk-update")).toHaveLength(1)
    expect(bodyOf(callsTo(fetchMock, "/library/bulk-update")[0])).toEqual({
      items: [
        { id: 1, changes: { year: 1999 } },
        { id: 2, changes: { year: 1999 } },
      ],
    })
    expect(toast.success).toHaveBeenCalledWith("Updated 1 file")
    expect(toast.error).toHaveBeenCalledWith("1 file failed to update")
    expect(toast.warning).toHaveBeenCalledWith("1 skipped, download in progress")
    expect(clear).toHaveBeenCalled()
  })

  it("a single selected item is a one-element list", async () => {
    items = [item(4)]
    const fetchMock = mockFetch(() => ({ status: 200, body: { results: [{ id: 4, ok: true }], succeeded: 1, failed: 0 } }))
    renderDialog()
    await userEvent.type(screen.getByRole("spinbutton"), "2001")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Updated 1 file"))
    expect(bodyOf(callsTo(fetchMock, "/library/bulk-update")[0])).toEqual({ items: [{ id: 4, changes: { year: 2001 } }] })
  })

  it("if the request itself fails, every editable file counts as failed", async () => {
    items = [item(1), item(2)]
    mockFetch(() => ({ status: 500, body: { error: "boom" } }))
    renderDialog()
    await userEvent.type(screen.getByRole("spinbutton"), "1980")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("2 files failed to update"))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
