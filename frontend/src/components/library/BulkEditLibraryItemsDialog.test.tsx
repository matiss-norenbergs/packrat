import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { mockFetch } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"
import { BulkEditLibraryItemsDialog, MAX_BULK_EDIT_FILES } from "./BulkEditLibraryItemsDialog"

let items: LibraryItem[] = []
vi.mock("./SelectionContext", () => ({
  useSelection: () => ({ selectedItems: new Map(items.map((i) => [i.id, i])), selectedCollectionIds: new Set<number>(), clear: vi.fn() }),
}))
vi.mock("@/hooks/useCollections", () => ({ useCollections: () => ({ data: [] }) }))
vi.mock("@/hooks/useLibrary", () => ({ libraryQueryKey: ["library"], useLibraryQuery: () => ({ data: undefined, isLoading: false }) }))
vi.mock("./BulkEditLibraryItemRow", () => ({ BulkEditLibraryItemRow: ({ item }: { item: LibraryItem }) => <div data-testid="row">{item.title}</div> }))

beforeEach(() => {
  mockFetch(() => ({ status: 200, body: [] }))
})

const make = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `Item ${i + 1}`, filename: `f${i + 1}.mp4`, tags: [], activeDownloadId: null }) as unknown as LibraryItem)

function renderDialog() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BulkEditLibraryItemsDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe("BulkEditLibraryItemsDialog size limit", () => {
  it("is 100 files", () => {
    expect(MAX_BULK_EDIT_FILES).toBe(100)
  })

  it("at the limit builds a row per file and Save is enabled", async () => {
    items = make(100)
    renderDialog()
    expect(await screen.findAllByTestId("row")).toHaveLength(100)
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("one over the limit shows the message, builds no rows and disables Save", async () => {
    items = make(101)
    renderDialog()
    expect(await screen.findByText("You selected 101 files. Narrow the selection to 100 or fewer to edit them individually.")).toBeTruthy()
    expect(screen.queryAllByTestId("row")).toHaveLength(0)
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
