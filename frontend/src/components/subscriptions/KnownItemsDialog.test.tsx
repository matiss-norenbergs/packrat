import { act, cleanup, fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { KnownItemsDialog } from "@/components/subscriptions/KnownItemsDialog"
import { renderWithProviders } from "@/test/mockApi"
import type { Subscription, SubscriptionEntry } from "@/types/api"

let entries: SubscriptionEntry[] | undefined
let loading = false
let addPending = false
const addMutate = vi.fn()
const seenMutate = vi.fn()
const unlinkMutate = vi.fn()

vi.mock("@/hooks/useSubscriptions", () => ({
  useSubscriptionEntries: () => ({ data: entries, isLoading: loading }),
  useBulkAddSubscriptionEntries: () => ({ mutate: addMutate, isPending: addPending }),
  useBulkMarkSubscriptionEntriesSeen: () => ({ mutate: seenMutate, isPending: false }),
  useBulkUnlinkSubscriptionEntries: () => ({ mutate: unlinkMutate, isPending: false }),
}))
vi.mock("./LinkLibraryItemDialog", () => ({
  LinkLibraryItemDialog: ({ entry }: { entry: SubscriptionEntry | null }) => (entry ? <div>link-dialog-{entry.sourceId}</div> : null),
}))

const SUB: Subscription = {
  id: 1,
  url: "https://x/c",
  title: "Channel",
  mediaType: "video",
  collectionId: null,
  collectionName: null,
  tags: [],
  autoDownload: false,
  generateNfo: false,
  checkIntervalHours: 6,
  enabled: true,
  lastCheckedAt: null,
  lastCheckError: null,
  knownEntryCount: 0,
  unseenEntryCount: 0,
  createdAt: "2026-09-01T00:00:00Z",
}

const entry = (id: string, over: Partial<SubscriptionEntry> = {}): SubscriptionEntry => ({
  sourceId: id,
  title: `Video ${id}`,
  url: `https://x/${id}`,
  durationSeconds: 65,
  libraryItemId: null,
  seenAt: "2026-09-02T00:00:00Z",
  firstSeenAt: "2026-09-01T00:00:00Z",
  linkedLibraryItemId: null,
  linkedLibraryItemIsGhost: false,
  ...over,
})

const rowEls = () => Array.from(document.querySelectorAll<HTMLElement>("tbody tr[data-row-id]"))
const pick = (i: number, init: MouseEventInit = {}) => fireEvent.mouseDown(rowEls()[i], { button: 0, ...init })
const btn = (name: RegExp | string) => screen.getByRole("button", { name })

const ui = (sub = SUB, open = true) => <KnownItemsDialog subscription={sub} open={open} onOpenChange={() => {}} />
const renderDialog = () => renderWithProviders(ui())

beforeEach(() => {
  entries = [
    entry("a", { seenAt: null }), // New
    entry("b", { linkedLibraryItemId: 9 }), // In library
    entry("c", { linkedLibraryItemId: 9, libraryItemId: 9, linkedLibraryItemIsGhost: true }), // In library (ghost), linked
    entry("d", { url: "", title: "", durationSeconds: null, seenAt: null }), // Unknown
  ]
  loading = false
  addPending = false
  addMutate.mockReset()
  seenMutate.mockReset()
  unlinkMutate.mockReset()
})
afterEach(() => cleanup())

describe("KnownItemsDialog table", () => {
  it("renders titles, durations, dates and the status badges", () => {
    renderDialog()
    const headers = screen.getAllByRole("columnheader")
    expect(headers.map((h) => h.textContent)).toEqual(["", "Title", "Duration", "First seen", "Status"])
    expect(headers[2]).toHaveClass("text-right")
    expect(headers[3]).toHaveClass("text-center")

    const cells = (i: number) => within(rowEls()[i]).getAllByRole("cell")
    expect(cells(0)[1]).toHaveTextContent("Video a")
    expect(cells(0)[1]).toHaveClass("overflow-hidden", "text-ellipsis", "whitespace-nowrap", "font-medium")
    expect(cells(0)[2]).toHaveTextContent("1:05")
    expect(cells(0)[2]).toHaveClass("text-right", "text-muted-foreground")
    expect(cells(0)[3]).toHaveTextContent(new Date("2026-09-01T00:00:00Z").toLocaleDateString())
    expect(within(cells(0)[4]).getByText("New")).toBeInTheDocument()
    expect(within(cells(1)[4]).getByText("In library")).toBeInTheDocument()
    expect(within(cells(2)[4]).getByText("In library (ghost)")).toBeInTheDocument()
    expect(cells(3)[1]).toHaveTextContent("Unknown")
    expect(within(cells(3)[4]).getByText("No details recorded")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Select entry" })).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Select Video a" })).toBeInTheDocument()
  })

  it("keeps one fixed-height bordered box for loading, empty and loaded", () => {
    loading = true
    entries = undefined
    const { rerender } = renderDialog()
    const box = (el: Element) => el.parentElement!
    const skeletons = document.querySelectorAll("[data-slot=skeleton]")
    expect(skeletons).toHaveLength(4)
    expect(skeletons[0].parentElement).toHaveClass("h-full", "space-y-1", "overflow-y-auto", "p-2")
    expect(box(skeletons[0].parentElement!)).toHaveClass("h-[60vh]", "overflow-hidden", "rounded-md", "border")
    expect(screen.getByText("—")).toBeInTheDocument() // footer placeholder while loading
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()

    loading = false
    entries = []
    rerender(ui())
    const msg = screen.getByText("No known items yet.")
    expect(msg).toHaveClass("text-center")
    expect(box(msg)).toHaveClass("h-[60vh]", "overflow-hidden", "rounded-md", "border")
    expect(screen.getByText("0 items")).toBeInTheDocument() // the footer stays for an empty list
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()

    entries = [entry("a")]
    rerender(ui())
    const container = screen.getByRole("table").parentElement!
    expect(container).toHaveClass("h-full", "overflow-auto")
    expect(box(container)).toHaveClass("h-[60vh]", "overflow-hidden", "rounded-md", "border")
  })

  it("pages 20 at a time with the count and selection in the footer", async () => {
    entries = Array.from({ length: 45 }, (_, i) => entry(`v${i}`))
    renderDialog()
    expect(rowEls()).toHaveLength(20)
    expect(screen.getByText("45 items")).toBeInTheDocument()
    pick(0)
    pick(2, { ctrlKey: true })
    expect(screen.getByText("45 items · 2 selected")).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(rowEls()).toHaveLength(20)
    expect(screen.getByText("45 items")).toBeInTheDocument() // selection cleared on a page change
    await user.click(screen.getByRole("button", { name: "3" }))
    expect(rowEls()).toHaveLength(5)
  })

  it("stays in the same mode while data arrives (loading -> empty -> loaded)", () => {
    const { rerender } = renderDialog()
    pick(0)
    expect(screen.getByText("4 items · 1 selected")).toBeInTheDocument()
    loading = true
    rerender(ui())
    expect(screen.queryByText(/^d+ items?/)).toBeNull()
    loading = false
    entries = []
    rerender(ui())
    expect(screen.getByText("0 items")).toBeInTheDocument()
    entries = Array.from({ length: 45 }, (_, i) => entry(`v${i}`))
    rerender(ui())
    expect(rowEls()).toHaveLength(20) // paged right away, no controlled-mode flash of 45 rows
    expect(screen.getByText("45 items")).toBeInTheDocument()
  })

  it("uses the singular for one item and drops the old top-right selection text", () => {
    entries = [entry("a")]
    renderDialog()
    expect(screen.getByText("1 item")).toBeInTheDocument()
    expect(screen.queryByText("Nothing selected")).toBeNull()
    pick(0)
    expect(screen.queryByText("1 selected")).toBeNull()
    expect(screen.getByText("1 item · 1 selected")).toBeInTheDocument()
  })

  it("goes back to page 1 and clears the selection for another subscription", () => {
    entries = Array.from({ length: 45 }, (_, i) => entry(`v${i}`))
    const { rerender } = renderDialog()
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    pick(0)
    expect(screen.getByText("45 items · 1 selected")).toBeInTheDocument()
    rerender(ui({ ...SUB, id: 2 }))
    expect(screen.getByText("45 items")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "page")
    expect(rowEls()[0]).toHaveAttribute("data-row-id", "v0")
  })

  it("clears the selection when the dialog is closed and reopened", () => {
    const { rerender } = renderDialog()
    pick(0)
    expect(btn("Add as ghost")).toBeEnabled()
    rerender(ui(SUB, false))
    rerender(ui(SUB, true))
    expect(btn("Add as ghost")).toBeDisabled()
  })
})

describe("KnownItemsDialog actions", () => {
  it("disables everything with nothing selected", () => {
    renderDialog()
    for (const name of ["Add as ghost", "Queue download", "Mark seen", "Link to library item…", "Unlink"]) {
      expect(btn(name)).toBeDisabled()
    }
  })

  it("applies the eligibility rules to the selection", () => {
    renderDialog()
    pick(3) // Unknown entry: no url, unseen
    expect(btn("Add as ghost")).toBeDisabled()
    expect(btn("Mark seen")).toBeEnabled()
    expect(btn("Unlink")).toBeDisabled()
    expect(btn("Link to library item…")).toBeEnabled()
    pick(1) // linked to a library item, but not via libraryItemId
    expect(btn("Add as ghost")).toBeEnabled()
    expect(btn("Mark seen")).toBeDisabled()
    expect(btn("Unlink")).toBeDisabled()
    pick(2) // linkedLibraryItemId + libraryItemId set
    expect(btn("Unlink")).toBeEnabled()
    pick(0, { ctrlKey: true })
    expect(btn("Link to library item…")).toBeDisabled() // two selected
  })

  it("queues a download immediately when nothing is already in the library", async () => {
    renderDialog()
    pick(0)
    await userEvent.setup().click(btn("Queue download"))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(addMutate).toHaveBeenCalledTimes(1)
    expect(addMutate.mock.calls[0][0]).toEqual({ subscriptionId: 1, sourceIds: ["a"], mode: "download" })
  })

  it("confirms with the counts when part of the selection is already in the library", async () => {
    renderDialog()
    const user = userEvent.setup()
    pick(0)
    pick(1, { ctrlKey: true })
    pick(3, { ctrlKey: true }) // no url: not eligible for add
    await user.click(btn("Add as ghost"))
    expect(addMutate).not.toHaveBeenCalled()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("1 of 2 selected items already in your library")
    expect(within(dialog).getByText(/Add another ghost placeholder/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Add as ghost" }))
    expect(addMutate).toHaveBeenCalledTimes(1)
    expect(addMutate.mock.calls[0][0]).toEqual({ subscriptionId: 1, sourceIds: ["a", "b"], mode: "ghost" })
  })

  it("lets the confirmation be cancelled", async () => {
    renderDialog()
    const user = userEvent.setup()
    pick(1)
    await user.click(btn("Queue download"))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/Queue another download/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(addMutate).not.toHaveBeenCalled()
  })

  it("marks only the unseen selected entries as seen, then clears the selection", async () => {
    renderDialog()
    pick(0)
    pick(1, { ctrlKey: true })
    await userEvent.setup().click(btn("Mark seen"))
    expect(seenMutate.mock.calls[0][0]).toEqual({ subscriptionId: 1, sourceIds: ["a"] })
    expect(btn("Mark seen")).toBeEnabled()
    act(() => seenMutate.mock.calls[0][1].onSuccess())
    expect(btn("Mark seen")).toBeDisabled()
  })

  it("unlinks only entries that have a libraryItemId", async () => {
    renderDialog()
    pick(1)
    pick(2, { ctrlKey: true })
    await userEvent.setup().click(btn("Unlink"))
    expect(unlinkMutate.mock.calls[0][0]).toEqual({ subscriptionId: 1, sourceIds: ["c"] })
  })

  it("opens the link picker for the one selected entry", async () => {
    renderDialog()
    pick(1)
    await userEvent.setup().click(btn("Link to library item…"))
    expect(screen.getByText("link-dialog-b")).toBeInTheDocument()
  })

  it("disables both add buttons while an add is in flight", () => {
    addPending = true
    renderDialog()
    pick(0)
    expect(btn("Add as ghost")).toBeDisabled()
    expect(btn("Queue download")).toBeDisabled()
  })
})
