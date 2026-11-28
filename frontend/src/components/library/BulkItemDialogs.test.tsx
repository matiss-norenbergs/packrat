import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BulkDeleteLibraryItemFilesDialog } from "@/components/library/BulkDeleteLibraryItemFilesDialog"
import { BulkDeleteLibraryItemsDialog } from "@/components/library/BulkDeleteLibraryItemsDialog"
import { BulkRedownloadLibraryItemsDialog } from "@/components/library/BulkRedownloadLibraryItemsDialog"
import { bodyOf, callsTo, mockFetch } from "@/test/mockApi"
import { flushTasks } from "@/test/settle"
import type { Collection, LibraryItem } from "@/types/api"

// The three bulk dialogs that remove or re-queue library items. What matters here is what leaves the browser:
// the exact ids, the deleteFiles / deleteThumbnail choice, and that nothing is sent unless the user confirms.
// The selection and the collection list are stubbed; the mutation hooks and the request layer are real, so every
// assertion is on the request that was actually sent (URL, method, JSON body).

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const clear = vi.fn()
let selected: LibraryItem[] = []
let selectedCollections: number[] = []
let collections: Collection[] = []
vi.mock("./SelectionContext", () => ({
  useSelection: () => ({
    selectedItems: new Map(selected.map((i) => [i.id, i])),
    selectedCollectionIds: new Set(selectedCollections),
    clear,
  }),
}))
vi.mock("@/hooks/useCollections", () => ({ useCollections: () => ({ data: collections }) }))
vi.mock("./LibraryItemPreviewRow", () => ({ LibraryItemPreviewRow: ({ item }: { item: LibraryItem }) => <div data-testid="preview-row">{item.title}</div> }))

const item = (id: number, over: Partial<LibraryItem> = {}) =>
  ({ id, title: `Item ${id}`, originalUrl: `https://example.com/${id}`, activeDownloadId: null, status: "complete", ...over }) as LibraryItem
const collection = (id: number, parentId: number | null = null) => ({ id, name: `C${id}`, parentId }) as Collection
const items = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => item(from + i))

// What the collection resolution (GET /library?collectionIds=...) returns.
let resolved: LibraryItem[] = []
let postStatus = 200
let postBody: unknown = {}

function serve() {
  return mockFetch((url, init) => {
    if (init.method === "POST") return { status: postStatus, body: postBody }
    if (url.includes("/library?")) return { status: 200, body: { items: resolved, total: resolved.length } }
    return { status: 404 }
  })
}
const posts = (fn: ReturnType<typeof serve>, path: string) => callsTo(fn, path).filter(([, init]) => init.method === "POST")
const sentIds = (fn: ReturnType<typeof serve>, path: string) => bodyOf(posts(fn, path)[0]).itemIds as number[]

beforeEach(() => {
  vi.clearAllMocks()
  selected = []
  selectedCollections = []
  collections = []
  resolved = []
  postStatus = 200
  postBody = {}
})

interface Variant {
  name: string
  Dialog: typeof BulkDeleteLibraryItemsDialog
  path: string
  confirm: string
  title: (n: number) => RegExp
  ok: unknown
  successToast: string
  errorToast: string
}
const VARIANTS: Variant[] = [
  {
    name: "BulkDeleteLibraryItemsDialog",
    Dialog: BulkDeleteLibraryItemsDialog,
    path: "/library/bulk-delete",
    confirm: "Delete",
    title: (n) => new RegExp(`^Delete ${n} selected ${n === 1 ? "file" : "files"}\\?$`),
    ok: { deleted: 3 },
    successToast: "Deleted 3 files",
    errorToast: "Failed to delete: boom",
  },
  {
    name: "BulkDeleteLibraryItemFilesDialog",
    Dialog: BulkDeleteLibraryItemFilesDialog,
    path: "/library/bulk-delete-file",
    confirm: "Delete file",
    title: (n) => new RegExp(`^Delete ${n} selected ${n === 1 ? "file" : "files"}\\?$`),
    ok: { deleted: 3, skipped: 0, skippedDownloading: 0 },
    successToast: "Deleted 3 files",
    errorToast: "Failed to delete: boom",
  },
  {
    name: "BulkRedownloadLibraryItemsDialog",
    Dialog: BulkRedownloadLibraryItemsDialog,
    path: "/library/bulk-redownload",
    confirm: "Download",
    title: (n) => new RegExp(`^Download ${n} selected ${n === 1 ? "file" : "files"}\\?$`),
    ok: { queued: 3, skipped: 0, skippedDownloading: 0 },
    successToast: "Queued 3 downloads",
    errorToast: "Failed to queue downloads: boom",
  },
]

function renderDialog(Dialog: Variant["Dialog"], open = true) {
  const onOpenChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const tree = (o: boolean) => (
    <QueryClientProvider client={client}>
      <Dialog open={o} onOpenChange={onOpenChange} />
    </QueryClientProvider>
  )
  const utils = render(tree(open))
  return { onOpenChange, reopen: (o: boolean) => utils.rerender(tree(o)) }
}
const user = () => userEvent.setup({ pointerEventsCheck: 0 })
const dialog = () => screen.getByRole("alertdialog")

describe.each(VARIANTS)("$name", (v) => {
  it("counts one item as singular", () => {
    serve()
    selected = [item(1)]
    renderDialog(v.Dialog)
    expect(screen.getByRole("heading", { name: v.title(1) })).toBeInTheDocument()
  })

  it("counts several items as plural", () => {
    serve()
    selected = [item(1), item(2)]
    renderDialog(v.Dialog)
    expect(screen.getByRole("heading", { name: v.title(2) })).toBeInTheDocument()
  })

  it("lists at most 20 items with a '+N more' line, but sends every id", async () => {
    const fn = serve()
    postBody = v.ok
    selected = items(1, 25)
    renderDialog(v.Dialog)
    expect(screen.getAllByTestId("preview-row")).toHaveLength(20)
    expect(screen.getByText("+5 more")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: v.title(25) })).toBeInTheDocument()
    await user().click(screen.getByRole("button", { name: v.confirm }))
    await waitFor(() => expect(posts(fn, v.path)).toHaveLength(1))
    expect(sentIds(fn, v.path)).toEqual(items(1, 25).map((i) => i.id))
  })

  it("shows no '+N more' line for exactly 20 items", () => {
    serve()
    selected = items(1, 20)
    renderDialog(v.Dialog)
    expect(screen.getAllByTestId("preview-row")).toHaveLength(20)
    expect(screen.queryByText(/more$/)).toBeNull()
  })

  it("resolves a selected collection and its sub-collections into concrete, deduplicated items", async () => {
    const fn = serve()
    postBody = v.ok
    collections = [collection(10), collection(11, 10), collection(99)]
    selectedCollections = [10]
    selected = [item(1)]
    resolved = [item(1), item(2), item(3)] // item 1 is selected and also in the collection
    renderDialog(v.Dialog)

    // The confirm button is held back until the collection has been resolved, then the count is the deduplicated total.
    await screen.findByRole("heading", { name: v.title(3) })
    const lookup = fn.mock.calls.map(([url]) => url).find((url) => url.includes("/library?"))!
    expect(new URL(lookup, "http://x").searchParams.get("collectionIds")).toBe("10,11") // the folder and its child, not 99

    await user().click(screen.getByRole("button", { name: v.confirm }))
    await waitFor(() => expect(posts(fn, v.path)).toHaveLength(1))
    expect(sentIds(fn, v.path)).toEqual([1, 2, 3])
  })

  it("disables the confirm button and says so when the selection resolves to nothing", async () => {
    const fn = serve()
    selected = []
    renderDialog(v.Dialog)
    expect(screen.getByRole("button", { name: v.confirm })).toBeDisabled()
    expect(dialog()).toHaveTextContent(/No (files|items with a source URL) in this selection\./)
    await user().click(screen.getByRole("button", { name: v.confirm }))
    await flushTasks()
    expect(posts(fn, v.path)).toHaveLength(0)
  })

  it("Cancel sends nothing, closes, and keeps the selection", async () => {
    const fn = serve()
    selected = items(1, 2)
    const { onOpenChange } = renderDialog(v.Dialog)
    await user().click(screen.getByRole("button", { name: "Cancel" }))
    expect(onOpenChange).toHaveBeenCalledWith(false) // sentinel: the click was handled
    await flushTasks()
    expect(posts(fn, v.path)).toHaveLength(0)
    expect(clear).not.toHaveBeenCalled()
  })

  it("Escape sends nothing, closes, and keeps the selection", async () => {
    const fn = serve()
    selected = items(1, 2)
    const { onOpenChange } = renderDialog(v.Dialog)
    await user().keyboard("{Escape}")
    expect(onOpenChange).toHaveBeenCalledWith(false) // sentinel: the key was handled
    await flushTasks()
    expect(posts(fn, v.path)).toHaveLength(0)
    expect(clear).not.toHaveBeenCalled()
  })

  it("confirming sends exactly one POST, then clears the selection and closes", async () => {
    const fn = serve()
    postBody = v.ok
    selected = items(1, 3)
    renderDialog(v.Dialog)
    await user().click(screen.getByRole("button", { name: v.confirm }))
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1)) // onSuccess ran
    expect(posts(fn, v.path)).toHaveLength(1)
    expect(posts(fn, v.path)[0][1].method).toBe("POST")
    expect(sentIds(fn, v.path)).toEqual([1, 2, 3])
    expect(toast.success).toHaveBeenCalledWith(v.successToast)
  })

  it("reports a failed request, keeps the selection, and can be retried", async () => {
    const fn = serve()
    postStatus = 500
    postBody = { error: "boom" }
    selected = items(1, 2)
    const { onOpenChange } = renderDialog(v.Dialog)
    const u = user()
    await u.click(screen.getByRole("button", { name: v.confirm }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(v.errorToast))
    expect(clear).not.toHaveBeenCalled() // the selection survives, so the action can be repeated
    // (Radix's AlertDialogAction asks the parent to close on every click, success or not; the parent decides. The dialog
    // here stays controlled-open, which is what a parent that ignores that request would show.)
    expect(screen.getByRole("button", { name: v.confirm })).toBeEnabled() // not stuck on "Deleting…" / "Queuing…"

    postStatus = 200
    postBody = v.ok
    await u.click(screen.getByRole("button", { name: v.confirm }))
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1))
    expect(posts(fn, v.path)).toHaveLength(2)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("sends items with an active download too (the server skips them) and reports the skipped count", async () => {
    const fn = serve()
    postBody = { ...(v.ok as object), skippedDownloading: 1 }
    selected = [item(1), item(2, { activeDownloadId: 77 })]
    renderDialog(v.Dialog)
    await user().click(screen.getByRole("button", { name: v.confirm }))
    await waitFor(() => expect(posts(fn, v.path)).toHaveLength(1))
    expect(sentIds(fn, v.path)).toEqual([1, 2])
    if (v.path !== "/library/bulk-delete") {
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`${v.successToast} (1 skipped, download in progress)`))
    }
  })
})

describe("BulkDeleteLibraryItemsDialog: the deleteFiles choice", () => {
  const body = (fn: ReturnType<typeof serve>) => bodyOf(posts(fn, "/library/bulk-delete")[0])
  const checkbox = () => screen.getByRole("checkbox", { name: "Also delete files from disk" })

  it("defaults to removing from the library only: deleteFiles is false", async () => {
    const fn = serve()
    postBody = { deleted: 2 }
    selected = items(1, 2)
    renderDialog(BulkDeleteLibraryItemsDialog)
    expect(checkbox()).not.toBeChecked()
    expect(dialog()).toHaveTextContent("The files themselves stay on disk.")
    await user().click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(posts(fn, "/library/bulk-delete")).toHaveLength(1))
    expect(body(fn)).toEqual({ itemIds: [1, 2], deleteFiles: false })
  })

  it("sends deleteFiles: true only when 'Also delete files from disk' is ticked, and warns first", async () => {
    const fn = serve()
    postBody = { deleted: 2 }
    selected = items(1, 2)
    renderDialog(BulkDeleteLibraryItemsDialog)
    await user().click(checkbox())
    expect(checkbox()).toBeChecked()
    expect(dialog()).toHaveTextContent("permanently deletes the file(s) too")
    await user().click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(posts(fn, "/library/bulk-delete")).toHaveLength(1))
    expect(body(fn)).toEqual({ itemIds: [1, 2], deleteFiles: true })
  })

  it("an un-ticked box after ticking and un-ticking is false again", async () => {
    const fn = serve()
    postBody = { deleted: 1 }
    selected = [item(1)]
    renderDialog(BulkDeleteLibraryItemsDialog)
    const u = user()
    await u.click(checkbox())
    await u.click(checkbox())
    await u.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(posts(fn, "/library/bulk-delete")).toHaveLength(1))
    expect(body(fn).deleteFiles).toBe(false)
  })

  it("resets the choice to false every time the dialog opens", async () => {
    const fn = serve()
    postBody = { deleted: 1 }
    selected = [item(1)]
    const { reopen } = renderDialog(BulkDeleteLibraryItemsDialog)
    await user().click(checkbox())
    expect(checkbox()).toBeChecked()
    reopen(false)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    reopen(true)
    expect(checkbox()).not.toBeChecked()
    await user().click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(posts(fn, "/library/bulk-delete")).toHaveLength(1))
    expect(body(fn).deleteFiles).toBe(false)
  })

  it("includes ghost items (no file on disk) in the request: they are removed from the library too", async () => {
    const fn = serve()
    postBody = { deleted: 2 }
    selected = [item(1), item(2, { status: "ghost" })]
    renderDialog(BulkDeleteLibraryItemsDialog)
    await user().click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(posts(fn, "/library/bulk-delete")).toHaveLength(1))
    expect(body(fn).itemIds).toEqual([1, 2])
  })
})

describe("BulkDeleteLibraryItemFilesDialog: the thumbnail choice", () => {
  const body = (fn: ReturnType<typeof serve>) => bodyOf(posts(fn, "/library/bulk-delete-file")[0])
  const checkbox = () => screen.getByRole("checkbox", { name: "Also delete thumbnails" })

  it("keeps the thumbnails by default and never sends a deleteFiles field", async () => {
    const fn = serve()
    postBody = { deleted: 2, skipped: 0, skippedDownloading: 0 }
    selected = items(1, 2)
    renderDialog(BulkDeleteLibraryItemFilesDialog)
    expect(checkbox()).not.toBeChecked()
    await user().click(screen.getByRole("button", { name: "Delete file" }))
    await waitFor(() => expect(posts(fn, "/library/bulk-delete-file")).toHaveLength(1))
    expect(body(fn)).toEqual({ itemIds: [1, 2], deleteThumbnail: false })
  })

  it("sends deleteThumbnail: true when ticked, and resets on the next open", async () => {
    const fn = serve()
    postBody = { deleted: 1, skipped: 0, skippedDownloading: 0 }
    selected = [item(1)]
    const { reopen } = renderDialog(BulkDeleteLibraryItemFilesDialog)
    await user().click(checkbox())
    await user().click(screen.getByRole("button", { name: "Delete file" }))
    await waitFor(() => expect(posts(fn, "/library/bulk-delete-file")).toHaveLength(1))
    expect(body(fn)).toEqual({ itemIds: [1], deleteThumbnail: true })

    reopen(false)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    reopen(true)
    expect(checkbox()).not.toBeChecked()
  })
})

describe("BulkRedownloadLibraryItemsDialog: items without a source URL", () => {
  it("leaves them out of the count, the preview and the request", async () => {
    const fn = serve()
    postBody = { queued: 2, skipped: 0, skippedDownloading: 0 }
    selected = [item(1), item(2, { originalUrl: "" }), item(3), item(4, { originalUrl: null as unknown as string })]
    renderDialog(BulkRedownloadLibraryItemsDialog)
    expect(screen.getByRole("heading", { name: /^Download 2 selected files\?$/ })).toBeInTheDocument()
    expect(within(dialog()).getAllByTestId("preview-row").map((r) => r.textContent)).toEqual(["Item 1", "Item 3"])
    await user().click(screen.getByRole("button", { name: "Download" }))
    await waitFor(() => expect(posts(fn, "/library/bulk-redownload")).toHaveLength(1))
    expect(bodyOf(posts(fn, "/library/bulk-redownload")[0])).toEqual({ itemIds: [1, 3] })
  })

  it("filters collection-resolved items the same way", async () => {
    const fn = serve()
    postBody = { queued: 1, skipped: 0, skippedDownloading: 0 }
    collections = [collection(10)]
    selectedCollections = [10]
    resolved = [item(5), item(6, { originalUrl: "" })]
    renderDialog(BulkRedownloadLibraryItemsDialog)
    await screen.findByRole("heading", { name: /^Download 1 selected file\?$/ })
    await user().click(screen.getByRole("button", { name: "Download" }))
    await waitFor(() => expect(posts(fn, "/library/bulk-redownload")).toHaveLength(1))
    expect(sentIds(fn, "/library/bulk-redownload")).toEqual([5])
  })

  it("with only URL-less items the button is disabled and nothing is sent", async () => {
    const fn = serve()
    selected = [item(1, { originalUrl: "" })]
    renderDialog(BulkRedownloadLibraryItemsDialog)
    expect(dialog()).toHaveTextContent("No items with a source URL in this selection.")
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled()
    await flushTasks()
    expect(posts(fn, "/library/bulk-redownload")).toHaveLength(0)
  })
})
