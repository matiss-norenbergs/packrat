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

const rowEls = () => Array.from(document.querySelectorAll<HTMLElement>("tr[data-backup-id]"))
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
    expect(await screen.findByRole("menuitem", { name: /^delete (2)$/i })).toBeTruthy()
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
