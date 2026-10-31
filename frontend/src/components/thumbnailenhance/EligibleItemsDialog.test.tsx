import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EligibleItemsDialog } from "@/components/thumbnailenhance/EligibleItemsDialog"
import { renderWithProviders } from "@/test/mockApi"
import type { ThumbnailEnhancementEligibleItem } from "@/types/api"

let items: ThumbnailEnhancementEligibleItem[] | undefined
let loading = false
let pending = false
const enhanceMutate = vi.fn()

vi.mock("@/hooks/useThumbnailEnhancement", () => ({
  useThumbnailEnhancementEligible: () => ({ data: items, isLoading: loading }),
  useEnhanceThumbnailItems: () => ({ mutate: enhanceMutate, isPending: pending }),
}))

const item = (id: number, over: Partial<ThumbnailEnhancementEligibleItem> = {}): ThumbnailEnhancementEligibleItem => ({
  libraryItemId: id,
  itemTitle: `Item ${id}`,
  width: 320,
  height: 180,
  artistName: null,
  collectionName: null,
  recentlyFailedAt: null,
  ...over,
})

const rowEls = () => Array.from(document.querySelectorAll<HTMLElement>("tbody tr[data-row-id]"))
const pick = (i: number, init: MouseEventInit = {}) => fireEvent.mouseDown(rowEls()[i], { button: 0, ...init })
const enhanceBtn = () => screen.getByRole("button", { name: /Enhance Selected/ })

function renderDialog() {
  return renderWithProviders(<EligibleItemsDialog open onOpenChange={() => {}} />)
}

beforeEach(() => {
  items = [
    item(1, { artistName: "Ann", collectionName: "Mix" }),
    item(2, { isProcessing: true }),
    item(3, { recentlyFailedAt: new Date(Date.now() - 10 * 60_000).toISOString() }),
    item(4),
  ]
  loading = false
  pending = false
  enhanceMutate.mockReset()
})
afterEach(() => cleanup())

describe("EligibleItemsDialog", () => {
  it("renders the columns with their cell content and alignment", () => {
    renderDialog()
    const headers = screen.getAllByRole("columnheader")
    expect(headers.map((h) => h.textContent)).toEqual(["", "Item", "Artist", "Collection", "Dimensions", "Status"])
    expect(headers[4]).toHaveClass("text-right")
    expect(headers[5]).toHaveClass("text-center")

    const first = within(rowEls()[0]).getAllByRole("cell")
    expect(within(first[1]).getByRole("link", { name: "Item 1" })).toHaveAttribute("href", "/library/1")
    expect(first[1]).toHaveClass("max-w-[280px]", "truncate")
    expect(first[2]).toHaveTextContent("Ann")
    expect(first[2]).toHaveClass("text-muted-foreground")
    expect(first[3]).toHaveTextContent("Mix")
    expect(first[4]).toHaveTextContent("320×180")
    expect(first[4]).toHaveClass("text-right")
    expect(within(rowEls()[3]).getAllByRole("cell")[2]).toHaveTextContent("—")
    expect(within(rowEls()[3]).getAllByRole("cell")[3]).toHaveTextContent("—")
  })

  it("shows the Enhancing and Recently failed badges, and nothing for a plain item", () => {
    renderDialog()
    expect(within(rowEls()[1]).getByText("Enhancing…")).toBeInTheDocument()
    expect(within(rowEls()[2]).getByText("Recently failed")).toBeInTheDocument()
    expect(within(rowEls()[0]).getAllByRole("cell")[5]).toBeEmptyDOMElement()
  })

  it("shows the skeletons inside the bordered box while loading", () => {
    loading = true
    items = undefined
    const { container } = renderDialog()
    expect(screen.queryByRole("table")).toBeNull()
    const skeletons = container.ownerDocument.querySelectorAll("[data-slot=skeleton]")
    expect(skeletons).toHaveLength(4)
    expect(skeletons[0].parentElement).toHaveClass("space-y-1", "p-2")
    expect(skeletons[0].parentElement!.parentElement).toHaveClass("max-h-[60vh]", "rounded-md", "border")
  })

  it("shows the footer with the item count under the box, but not while loading", () => {
    const { unmount } = renderDialog()
    expect(screen.getByText("4 items")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
    expect(screen.queryByText("Nothing selected")).toBeNull()
    unmount()
    loading = true
    items = undefined
    renderDialog()
    expect(screen.queryByText(/^d+ items?/)).toBeNull()
  })

  it("selects every item on select-all, however many there are", () => {
    items = Array.from({ length: 120 }, (_, i) => item(i + 1))
    renderDialog()
    expect(rowEls()).toHaveLength(120)
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(screen.getByText("120 items · 120 selected")).toBeInTheDocument()
  })

  it("shows the empty message in the same box", () => {
    items = []
    renderDialog()
    const msg = screen.getByText("Nothing eligible right now.")
    expect(msg).toHaveClass("text-center")
    expect(msg.parentElement).toHaveClass("max-h-[60vh]", "rounded-md", "border")
    expect(screen.getByText("0 items")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  it("uses a single scroll container so the header can stick", () => {
    renderDialog()
    const container = screen.getByRole("table").parentElement!
    expect(container).toHaveClass("overflow-auto")
    expect(container.parentElement).toHaveClass("max-h-[60vh]", "overflow-hidden", "rounded-md", "border")
    expect(screen.getAllByRole("columnheader")[0].closest("thead")).toHaveClass("sticky")
  })

  it("selects by row click, ctrl-click, drag and select-all and reports the count", () => {
    renderDialog()
    expect(enhanceBtn()).toBeDisabled()
    pick(0)
    expect(screen.getByText("4 items · 1 selected")).toBeInTheDocument()
    expect(enhanceBtn()).toBeEnabled()
    pick(2, { ctrlKey: true })
    expect(screen.getByText("4 items · 2 selected")).toBeInTheDocument()
    pick(1) // plain click replaces the selection
    fireEvent.mouseEnter(rowEls()[3])
    fireEvent.mouseUp(window)
    expect(screen.getByText("4 items · 3 selected")).toBeInTheDocument() // drag 1 -> 3
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(screen.getByText("4 items · 4 selected")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Select Item 2" })).toBeChecked()
  })

  it("Enhance Selected sends the selected ids and clears the selection on success", async () => {
    renderDialog()
    pick(0)
    pick(2, { ctrlKey: true })
    await userEvent.setup().click(enhanceBtn())
    expect(enhanceMutate).toHaveBeenCalledTimes(1)
    const [ids, opts] = enhanceMutate.mock.calls[0]
    expect([...ids].sort()).toEqual([1, 3])
    opts.onSuccess()
    expect(await screen.findByText("4 items")).toBeInTheDocument()
    expect(enhanceBtn()).toBeDisabled()
  })

  it("disables Enhance Selected while the request is pending", () => {
    pending = true
    renderDialog()
    pick(0)
    expect(enhanceBtn()).toBeDisabled()
  })
})
