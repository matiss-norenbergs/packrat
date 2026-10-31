import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackupHistoryTable } from "@/components/backup/BackupHistoryTable"
import { renderWithProviders } from "@/test/mockApi"
import type { BackupHistoryEntry } from "@/types/api"

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) } }))

let history: BackupHistoryEntry[] | undefined
let loading = false
const deleteAsync = vi.fn()
const restoreMutate = vi.fn()
const runMutate = vi.fn()

vi.mock("@/hooks/useBackup", () => ({
  backupHistoryQueryKey: ["backup-history"],
  useBackupHistory: () => ({ data: history, isLoading: loading }),
  useRunManualBackup: () => ({ mutate: runMutate, isPending: false }),
  useDeleteBackupHistoryEntry: () => ({ mutateAsync: deleteAsync }),
  useRestoreFullBackup: () => ({ mutate: restoreMutate }),
}))
// Tooltip content only exists while a tooltip is open (and never on a disabled button); render it inline so the
// disabled-reason strings can be asserted.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span data-testid="tip">{children}</span>,
}))
vi.mock("@/components/backup/BackupContentPreviewDialog", () => ({
  BackupContentPreviewDialog: ({ backupId }: { backupId: number | null }) =>
    backupId != null ? <div>preview-dialog-{backupId}</div> : null,
}))

const entry = (id: number, over: Partial<BackupHistoryEntry> = {}): BackupHistoryEntry => ({
  id,
  createdAt: new Date(2026, 9, 25, 10, id).toISOString(),
  triggerType: "manual",
  status: "success",
  fileName: `backup-${id}.json`,
  fileSizeBytes: 1024,
  libraryItemsCount: 1,
  collectionsCount: 0,
  tagsCount: 0,
  artistsCount: 0,
  errorMessage: null,
  ...over,
})

const OK1 = entry(1)
const OK2 = entry(2)
const FAILED = entry(3, { status: "failed", fileName: null, fileSizeBytes: null, errorMessage: "disk full" })

const rowEls = () => Array.from(document.querySelectorAll<HTMLElement>("tbody tr[data-row-id]"))
const pick = (i: number) => fireEvent.mouseDown(rowEls()[i], { button: 0 })
const toolbarBtn = (name: RegExp) => screen.getByRole("button", { name })

beforeEach(() => {
  history = [OK1, OK2, FAILED]
  loading = false
  deleteAsync.mockReset().mockResolvedValue(undefined)
  restoreMutate.mockReset()
  runMutate.mockReset()
  toastError.mockReset()
  toastSuccess.mockReset()
})
afterEach(() => cleanup())

describe("BackupHistoryTable", () => {
  it("keeps the toolbar visible with disabled buttons when empty or loading", () => {
    history = []
    const { unmount } = renderWithProviders(<BackupHistoryTable />)
    expect(screen.getByText("No backups yet.")).toBeTruthy()
    expect(toolbarBtn(/run backup now/i).hasAttribute("disabled")).toBe(false)
    for (const n of [/preview/i, /download/i, /restore/i, /delete/i]) expect(toolbarBtn(n).hasAttribute("disabled")).toBe(true)
    unmount()
    loading = true
    history = undefined
    renderWithProviders(<BackupHistoryTable />)
    expect(toolbarBtn(/preview/i).hasAttribute("disabled")).toBe(true)
  })

  it("enables toolbar buttons per selection", () => {
    renderWithProviders(<BackupHistoryTable />)
    for (const n of [/preview/i, /download/i, /restore/i, /delete/i]) expect(toolbarBtn(n).hasAttribute("disabled")).toBe(true)

    pick(0)
    for (const n of [/preview/i, /download/i, /restore/i, /delete/i]) expect(toolbarBtn(n).hasAttribute("disabled")).toBe(false)

    pick(2) // failed: only Delete
    for (const n of [/preview/i, /download/i, /restore/i]) expect(toolbarBtn(n).hasAttribute("disabled")).toBe(true)
    expect(toolbarBtn(/delete/i).hasAttribute("disabled")).toBe(false)

    fireEvent.mouseDown(rowEls()[1], { button: 0, ctrlKey: true }) // several
    for (const n of [/preview/i, /download/i, /restore/i]) expect(toolbarBtn(n).hasAttribute("disabled")).toBe(true)
    expect(toolbarBtn(/^delete$/i).hasAttribute("disabled")).toBe(false)
  })

  it("shows file actions in the context menu only for one successful row", async () => {
    renderWithProviders(<BackupHistoryTable />)
    fireEvent.contextMenu(rowEls()[0])
    expect(await screen.findByRole("menuitem", { name: /preview/i })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /download/i })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /restore/i })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /^delete$/i })).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: /preview/i })).toBeNull())

    fireEvent.contextMenu(rowEls()[2]) // failed row gets selected alone
    expect(await screen.findByRole("menuitem", { name: /^delete$/i })).toBeTruthy()
    expect(screen.queryByRole("menuitem", { name: /preview/i })).toBeNull()
    expect(screen.queryByRole("menuitem", { name: /restore/i })).toBeNull()
  })

  it("keeps the selection when right-clicking an already selected row", async () => {
    renderWithProviders(<BackupHistoryTable />)
    pick(0)
    fireEvent.mouseDown(rowEls()[1], { button: 0, ctrlKey: true })
    fireEvent.contextMenu(rowEls()[1])
    expect(await screen.findByRole("menuitem", { name: /^delete \(2\)$/i })).toBeTruthy()
    expect(screen.queryByRole("menuitem", { name: /preview/i })).toBeNull()
  })

  it("confirms with the count, deletes every selected id and shows one summary toast", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BackupHistoryTable />)
    pick(0)
    fireEvent.mouseDown(rowEls()[2], { button: 0, shiftKey: true })
    await user.click(toolbarBtn(/^delete$/i))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Delete 3 backups?")).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Deleted 3 backups"))
    expect(deleteAsync.mock.calls.map((c) => c[0])).toEqual([1, 2, 3])
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toolbarBtn(/delete/i).hasAttribute("disabled")).toBe(true) // selection cleared
  })

  it("confirms a single delete too, with the existing wording", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BackupHistoryTable />)
    pick(2)
    await user.click(toolbarBtn(/delete/i))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Delete this backup?")).toBeTruthy()
    expect(deleteAsync).not.toHaveBeenCalled()
  })

  it("summarises a partial failure in one toast", async () => {
    const user = userEvent.setup()
    deleteAsync.mockImplementation(async (id: number) => {
      if (id === 2) throw new Error("boom")
    })
    renderWithProviders(<BackupHistoryTable />)
    pick(0)
    fireEvent.mouseDown(rowEls()[1], { button: 0, shiftKey: true })
    await user.click(toolbarBtn(/^delete$/i))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Deleted 1, 1 failed"))
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("restores the row the dialog was opened for even if the selection changes", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BackupHistoryTable />)
    pick(0)
    await user.click(toolbarBtn(/restore/i))
    const dialog = await screen.findByRole("alertdialog")
    pick(1)
    await user.click(within(dialog).getByRole("button", { name: "Restore" }))
    expect(restoreMutate).toHaveBeenCalledWith({ id: 1, mode: "download" })
  })

  it("opens the preview for the selected row and runs a backup", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BackupHistoryTable />)
    pick(1)
    await user.click(toolbarBtn(/preview/i))
    expect(screen.getByText("preview-dialog-2")).toBeTruthy()
    await user.click(toolbarBtn(/run backup now/i))
    expect(runMutate).toHaveBeenCalled()
  })
})

const tips = () => screen.getAllByTestId("tip").map((t) => t.textContent)

describe("BackupHistoryTable as a DataTable", () => {
  it("renders the five columns with the alignment presets and the cell content", () => {
    history = [
      entry(1, { triggerType: "scheduled", libraryItemsCount: 5, collectionsCount: 2, tagsCount: 3, artistsCount: 4, fileSizeBytes: 2048 }),
      entry(3, { status: "failed", fileName: null, fileSizeBytes: null, errorMessage: "disk full" }),
    ]
    renderWithProviders(<BackupHistoryTable />)
    const headers = screen.getAllByRole("columnheader")
    expect(headers.map((h) => h.textContent)).toEqual(["", "Date", "Trigger", "Status", "Contents", "Size"])
    expect(headers[1]).toHaveClass("text-center")
    expect(headers[3]).toHaveClass("text-center")
    expect(headers[5]).toHaveClass("text-right")
    expect(headers[2].className).not.toMatch(/text-(right|center)/)
    expect(headers[4].className).not.toMatch(/text-(right|center)/)
    expect(screen.getByRole("table")).toHaveClass("table-fixed")

    const ok = rowEls()[0]
    expect(within(ok).getByText(new Date(history[0].createdAt).toLocaleString())).toBeTruthy()
    expect(within(ok).getByText("Scheduled")).toBeTruthy()
    expect(within(ok).getByText("Success")).toBeTruthy()
    expect(within(ok).getByText("5 items · 2 collections · 3 tags · 4 artists")).toBeTruthy()
    expect(within(ok).getByText("2.0 KB")).toBeTruthy()
    expect(ok.children[1]).toHaveClass("text-center")
    expect(ok.children[5]).toHaveClass("text-right")

    const failed = rowEls()[1]
    expect(within(failed).getByText("Manual")).toBeTruthy()
    expect(within(failed).getByText("Failed")).toBeTruthy()
    const error = within(failed).getByText("disk full")
    expect(error).toHaveClass("truncate", "text-destructive")
    expect(error).toHaveAttribute("title", "disk full")
    expect(failed.children[4].textContent).toBe("—") // contents of a failed backup
    expect(failed.children[5].textContent).toBe("—") // no size
  })

  it("keeps the embedded-in-a-card look: no border or fill-height container, 1rem gap, no footer or search", () => {
    renderWithProviders(<BackupHistoryTable />)
    const container = screen.getByRole("table").parentElement!
    expect(container.className).toBe("relative w-full overflow-x-auto")
    expect(container.className).not.toMatch(/border|h-full/)
    const root = container.parentElement!.parentElement!
    expect(root).toHaveClass("gap-4")
    expect(root).not.toHaveClass("gap-6")
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    // The toolbar row keeps its classes.
    expect(toolbarBtn(/run backup now/i).parentElement).toHaveClass("flex", "flex-wrap", "items-center", "gap-2")
  })

  it("keeps the disabled-reason tooltips for none, several, a failed backup and a single one", () => {
    renderWithProviders(<BackupHistoryTable />)
    expect(tips()).toEqual(["Select a backup", "Select a backup", "Select a backup", "Select one or more backups"])
    pick(0)
    expect(tips()).toEqual(["Preview this backup's contents", "Download this backup", "Restore this backup", "Delete this backup"])
    pick(2)
    expect(tips()).toEqual([
      "This backup failed, so there is no file",
      "This backup failed, so there is no file",
      "This backup failed, so there is no file",
      "Delete this backup",
    ])
    fireEvent.mouseDown(rowEls()[0], { button: 0, ctrlKey: true })
    expect(tips()).toEqual(["Select a single backup", "Select a single backup", "Select a single backup", "Delete 2 backups"])
  })

  it("select-all, shift-range and drag select rows; the header checkbox again clears", () => {
    renderWithProviders(<BackupHistoryTable />)
    const checked = () => rowEls().map((r) => r.getAttribute("data-state") === "selected")
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(checked()).toEqual([true, true, true])
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(checked()).toEqual([false, false, false])

    fireEvent.mouseDown(rowEls()[0], { button: 0 })
    fireEvent.mouseEnter(rowEls()[2])
    fireEvent.mouseUp(window)
    expect(checked()).toEqual([true, true, true])
    pick(1)
    fireEvent.mouseUp(window)
    expect(checked()).toEqual([false, true, false])
    fireEvent.mouseDown(rowEls()[2], { button: 0, shiftKey: true })
    fireEvent.mouseUp(window)
    expect(checked()).toEqual([false, true, true])
  })

  it("gives every row's checkbox its dated label", () => {
    renderWithProviders(<BackupHistoryTable />)
    expect(screen.getByRole("checkbox", { name: `Select backup from ${new Date(OK1.createdAt).toLocaleString()}` })).toBeTruthy()
  })

  it("lists Preview, Download, Restore, Delete in that order for one successful backup", async () => {
    renderWithProviders(<BackupHistoryTable />)
    fireEvent.contextMenu(rowEls()[0])
    await screen.findByRole("menuitem", { name: /preview/i })
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Preview", "Download", "Restore", "Delete"])
  })

  it("lists only Delete for a failed backup and Delete (n) for a failed + successful selection", async () => {
    renderWithProviders(<BackupHistoryTable />)
    fireEvent.contextMenu(rowEls()[2])
    await screen.findByRole("menuitem", { name: "Delete" })
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Delete"])
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull())

    fireEvent.mouseDown(rowEls()[0], { button: 0, ctrlKey: true })
    fireEvent.contextMenu(rowEls()[0])
    await screen.findByRole("menuitem", { name: "Delete (2)" })
    expect(screen.getAllByRole("menuitem")).toHaveLength(1)
  })

  it("right-clicking the header opens no menu", () => {
    renderWithProviders(<BackupHistoryTable />)
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "Date" }))
    expect(screen.queryByRole("menuitem")).toBeNull()
  })

  it("context-menu Preview and Restore act on the right row", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BackupHistoryTable />)
    fireEvent.contextMenu(rowEls()[1])
    await user.click(await screen.findByRole("menuitem", { name: /preview/i }))
    expect(screen.getByText("preview-dialog-2")).toBeTruthy()

    fireEvent.contextMenu(rowEls()[0])
    await user.click(await screen.findByRole("menuitem", { name: /restore/i }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Restore this backup?")).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "Restore" }))
    expect(restoreMutate).toHaveBeenCalledWith({ id: 1, mode: "download" })
  })

  it("context-menu Delete on a multi-selection confirms with the count and deletes every id", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BackupHistoryTable />)
    pick(0)
    fireEvent.mouseDown(rowEls()[2], { button: 0, ctrlKey: true })
    fireEvent.contextMenu(rowEls()[2])
    await user.click(await screen.findByRole("menuitem", { name: "Delete (2)" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Delete 2 backups?")).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Deleted 2 backups"))
    expect(deleteAsync.mock.calls.map((c) => c[0])).toEqual([1, 3])
  })

  it("keeps the single-delete toasts for success and failure", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BackupHistoryTable />)
    pick(0)
    await user.click(toolbarBtn(/^delete$/i))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Backup deleted"))

    toastSuccess.mockReset()
    deleteAsync.mockRejectedValue(new Error("boom"))
    pick(1)
    await user.click(toolbarBtn(/^delete$/i))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Delete failed: boom"))
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("reports a total failure of several deletes in one toast", async () => {
    const user = userEvent.setup()
    deleteAsync.mockRejectedValue(new Error("boom"))
    renderWithProviders(<BackupHistoryTable />)
    pick(0)
    fireEvent.mouseDown(rowEls()[1], { button: 0, shiftKey: true })
    await user.click(toolbarBtn(/^delete$/i))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Delete failed for 2 backups"))
  })

  it("ignores ids of rows that vanished from the data", () => {
    renderWithProviders(<BackupHistoryTable />)
    pick(1) // OK2
    expect(tips().at(-1)).toBe("Delete this backup")
    history = [OK1, FAILED] // OK2 vanished; the next render prunes its id
    fireEvent.mouseDown(rowEls()[0], { button: 0, ctrlKey: true }) // any selection change re-renders the table
    expect(rowEls()).toHaveLength(2)
    expect(tips().at(-1)).toBe("Delete this backup") // only OK1, just toggled on
    pick(1)
    expect(rowEls().map((r) => r.getAttribute("data-state"))).toEqual([null, "selected"])
  })

  it("shows skeletons while loading and the empty message with no footer when there are no backups", () => {
    loading = true
    history = undefined
    const { unmount } = renderWithProviders(<BackupHistoryTable />)
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.queryByText("No backups yet.")).toBeNull()
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    unmount()
    loading = false
    history = []
    renderWithProviders(<BackupHistoryTable />)
    expect(screen.getByText("No backups yet.")).toBeTruthy()
    expect(screen.queryByText(/^0 /)).toBeNull()
  })
})
