import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BackupPage } from "@/pages/BackupPage"
import { bodyOf, callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
import { flushTasks } from "@/test/settle"

// The import side of the Backup page: choose a file, preview it, confirm, and what is POSTed. Layout is not under test.
// The file's text is sent as-is in `data` (not base64), `password` is left out when empty, and `mode` is chosen by the user.

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
vi.mock("@/components/backup/BackupHistoryTable", () => ({ BackupHistoryTable: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

const PLAIN = JSON.stringify({ version: 1, kind: "full", settings: { maxConcurrentDownloads: 3 } })
const ENCRYPTED = JSON.stringify({ encrypted: true, salt: "s", nonce: "n", ciphertext: "c" })

const libraryPreview = {
  collections: [],
  collectionsNew: 0,
  tags: [],
  tagsNew: 0,
  artists: [],
  artistsNew: 0,
  items: [],
  alreadyInLibrary: 0,
}
const libraryResult = {
  downloadsQueued: 2,
  ghostsCreated: 1,
  collectionsEnsured: 0,
  tagsCreated: 0,
  artistsCreated: 0,
  collectionsCreated: 0,
}

interface Server {
  status?: Record<string, number>
  error?: Record<string, string>
  adjusted?: unknown[]
}
function serve(over: Server = {}) {
  const respond = (path: string, ok: unknown) => {
    const status = over.status?.[path] ?? 200
    return { status, body: status === 200 ? ok : { error: over.error?.[path] ?? "failed" } }
  }
  return mockFetch((url, init) => {
    for (const path of ["/backup/preview/full", "/backup/import/full", "/backup/import/settings", "/backup/preview/library", "/backup/import/library"]) {
      if (url.endsWith(path) && init.method === "POST") {
        const ok: Record<string, unknown> = {
          "/backup/preview/full": { settingsCount: 7, library: libraryPreview },
          "/backup/import/full": { settingsApplied: 3, library: libraryResult, adjusted: over.adjusted },
          "/backup/import/settings": { applied: 4, adjusted: over.adjusted },
          "/backup/preview/library": libraryPreview,
          "/backup/import/library": libraryResult,
        }
        return respond(path, ok[path])
      }
    }
    return { status: 200, body: [] } // settings, history, anything else the page asks for
  })
}
const posts = (fn: ReturnType<typeof serve>, path: string) => callsTo(fn, path).filter(([, init]) => init.method === "POST")

function setup() {
  renderWithProviders(<BackupPage />)
  const card = (title: string) => within(screen.getByText(title).closest("[data-slot=card]") as HTMLElement)
  return { user: userEvent.setup({ pointerEventsCheck: 0 }), card }
}
const file = (text: string) => new File([text], "backup.json", { type: "application/json" })

describe("Full Backup import", () => {
  it("Preview of a plain file posts the file text as `data`, with no password, and shows the preview dialog", async () => {
    const fn = serve()
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Full backup file"), file(PLAIN))
    expect(screen.queryByLabelText("Password")).toBeNull() // not encrypted: no password prompt
    await user.click(card("Full Backup").getByRole("button", { name: "Preview" }))
    expect(await screen.findByRole("dialog", { name: "Import preview" })).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveTextContent("7 settings entries")
    expect(posts(fn, "/backup/preview/full")).toHaveLength(1)
    expect(bodyOf(posts(fn, "/backup/preview/full")[0])).toEqual({ data: PLAIN })
    expect(posts(fn, "/backup/import/full")).toHaveLength(0) // previewing never imports
  })

  it("a file with no content keeps Preview and Import disabled", async () => {
    serve()
    const { user, card } = setup()
    expect(card("Full Backup").getByRole("button", { name: "Preview" })).toBeDisabled()
    expect(card("Full Backup").getByRole("button", { name: "Import" })).toBeDisabled()
    await user.upload(screen.getByLabelText("Full backup file"), file(PLAIN))
    expect(card("Full Backup").getByRole("button", { name: "Preview" })).toBeEnabled()
    expect(card("Full Backup").getByRole("button", { name: "Import" })).toBeEnabled()
  })

  it("an encrypted file asks for the password first and sends it", async () => {
    const fn = serve()
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Full backup file"), file(ENCRYPTED))
    const preview = card("Full Backup").getByRole("button", { name: "Preview" })
    expect(preview).toBeDisabled() // no password yet
    await user.type(card("Full Backup").getByLabelText("Password"), "hunter2")
    expect(preview).toBeEnabled()
    await user.click(preview)
    await screen.findByRole("dialog", { name: "Import preview" })
    expect(bodyOf(posts(fn, "/backup/preview/full")[0])).toEqual({ data: ENCRYPTED, password: "hunter2" })
  })

  it("a wrong password reports the server's message and shows no preview", async () => {
    const fn = serve({ status: { "/backup/preview/full": 400 }, error: { "/backup/preview/full": "wrong password" } })
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Full backup file"), file(ENCRYPTED))
    await user.type(card("Full Backup").getByLabelText("Password"), "nope")
    await user.click(card("Full Backup").getByRole("button", { name: "Preview" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Preview failed: wrong password"))
    expect(posts(fn, "/backup/preview/full")).toHaveLength(1)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(card("Full Backup").getByRole("button", { name: "Preview" })).toBeEnabled() // can try again
  })

  it("an invalid file is sent as it is and the server's rejection is shown", async () => {
    const fn = serve({ status: { "/backup/preview/full": 400 }, error: { "/backup/preview/full": "not a Packrat backup" } })
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Full backup file"), file("this is not json"))
    expect(screen.queryByLabelText("Password")).toBeNull() // unparseable: treated as unencrypted, the server has the say
    await user.click(card("Full Backup").getByRole("button", { name: "Preview" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Preview failed: not a Packrat backup"))
    expect(bodyOf(posts(fn, "/backup/preview/full")[0])).toEqual({ data: "this is not json" })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("'Import Now' in the preview posts the file with the default mode, reports the result and the adjusted values, and resets the form", async () => {
    const fn = serve({ adjusted: [{ key: "maxConcurrentDownloads", action: "clamped", from: 5000, to: 16 }, { key: "x", action: "skipped" }] })
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Full backup file"), file(PLAIN))
    await user.click(card("Full Backup").getByRole("button", { name: "Preview" }))
    await user.click(await screen.findByRole("button", { name: "Import Now" }))

    await waitFor(() => expect(posts(fn, "/backup/import/full")).toHaveLength(1))
    expect(bodyOf(posts(fn, "/backup/import/full")[0])).toEqual({ data: PLAIN, mode: "download" })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Restored 3 settings, queued 2 downloads, restored 1 ghost item"))
    expect(toast.info).toHaveBeenCalledWith("2 values were adjusted", {
      description: "maxConcurrentDownloads 5000 → 16; x skipped",
      duration: 20000,
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(card("Full Backup").getByRole("button", { name: "Import" })).toBeDisabled() // the file was cleared
  })

  it("no `adjusted` list means no adjusted toast", async () => {
    serve()
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Full backup file"), file(PLAIN))
    await user.click(card("Full Backup").getByRole("button", { name: "Preview" }))
    await user.click(await screen.findByRole("button", { name: "Import Now" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    await flushTasks()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it("choosing 'Import as ghost items' in the preview sends mode: ghostOnly", async () => {
    const fn = serve()
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Full backup file"), file(PLAIN))
    await user.click(card("Full Backup").getByRole("button", { name: "Preview" }))
    const dialog = await screen.findByRole("dialog", { name: "Import preview" })
    await user.click(within(dialog).getByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "Import as ghost items" }))
    await user.click(within(dialog).getByRole("button", { name: "Import Now" }))
    await waitFor(() => expect(posts(fn, "/backup/import/full")).toHaveLength(1))
    expect(bodyOf(posts(fn, "/backup/import/full")[0])).toEqual({ data: PLAIN, mode: "ghostOnly" })
  })

  it("the Import button needs a confirmation: Cancel posts nothing, Import posts once", async () => {
    const fn = serve()
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Full backup file"), file(PLAIN))
    await user.click(card("Full Backup").getByRole("button", { name: "Import" }))
    const confirm = await screen.findByRole("alertdialog")
    expect(confirm).toHaveTextContent("Import this full backup?")
    expect(posts(fn, "/backup/import/full")).toHaveLength(0) // opening the confirmation sends nothing

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await flushTasks()
    expect(posts(fn, "/backup/import/full")).toHaveLength(0)

    await user.click(card("Full Backup").getByRole("button", { name: "Import" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Import" }))
    await waitFor(() => expect(posts(fn, "/backup/import/full")).toHaveLength(1))
    expect(bodyOf(posts(fn, "/backup/import/full")[0])).toEqual({ data: PLAIN, mode: "download" })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it("a rejected import (413 too large) is reported, keeps the file so it can be retried, and does not reset the form", async () => {
    const fn = serve({ status: { "/backup/import/full": 413 }, error: { "/backup/import/full": "request body too large" } })
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Full backup file"), file(PLAIN))
    await user.click(card("Full Backup").getByRole("button", { name: "Import" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Import" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Import failed: request body too large"))
    expect(toast.success).not.toHaveBeenCalled()
    expect(posts(fn, "/backup/import/full")).toHaveLength(1)
    expect(card("Full Backup").getByRole("button", { name: "Import" })).toBeEnabled() // the file is still chosen
  })
})

describe("Settings backup import", () => {
  it("confirming posts the file as `data` once and reports how many settings were applied (and adjusted)", async () => {
    const fn = serve({ adjusted: [{ key: "ytdlpRetries", action: "clamped", from: 999, to: 100 }] })
    const { user, card } = setup()
    const settings = JSON.stringify({ version: 1, kind: "settings", settings: {} })
    await user.upload(screen.getByLabelText("Settings backup file"), file(settings))
    await user.click(card("Settings").getByRole("button", { name: "Import" }))
    const confirm = await screen.findByRole("alertdialog")
    expect(confirm).toHaveTextContent("overwrite your current settings")
    expect(posts(fn, "/backup/import/settings")).toHaveLength(0)

    await user.click(within(confirm).getByRole("button", { name: "Import" }))
    await waitFor(() => expect(posts(fn, "/backup/import/settings")).toHaveLength(1))
    expect(bodyOf(posts(fn, "/backup/import/settings")[0])).toEqual({ data: settings })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Imported 4 settings"))
    expect(toast.info).toHaveBeenCalledWith("1 value was adjusted to their limits", { description: "ytdlpRetries 999 → 100", duration: 20000 })
  })

  it("Cancel in the confirmation posts nothing", async () => {
    const fn = serve()
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Settings backup file"), file(PLAIN))
    await user.click(card("Settings").getByRole("button", { name: "Import" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await flushTasks()
    expect(posts(fn, "/backup/import/settings")).toHaveLength(0)
  })

  it("a failed import is reported with the server's message", async () => {
    serve({ status: { "/backup/import/settings": 400 }, error: { "/backup/import/settings": "wrong password" } })
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Settings backup file"), file(ENCRYPTED))
    await user.type(card("Settings").getByLabelText("Password"), "x")
    await user.click(card("Settings").getByRole("button", { name: "Import" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Import" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Import failed: wrong password"))
  })
})

describe("Library backup import", () => {
  it("previews with the file text and the password, then imports from the confirmation with the chosen mode", async () => {
    const fn = serve()
    const { user, card } = setup()
    await user.upload(screen.getByLabelText("Library backup file"), file(ENCRYPTED))
    await user.type(card("Library Data").getByLabelText("Password"), "pw")
    await user.click(card("Library Data").getByRole("button", { name: "Preview" }))
    await screen.findByRole("dialog", { name: "Import preview" })
    expect(bodyOf(posts(fn, "/backup/preview/library")[0])).toEqual({ data: ENCRYPTED, password: "pw" })
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(posts(fn, "/backup/import/library")).toHaveLength(0)

    await user.click(card("Library Data").getByRole("button", { name: "Import" }))
    const confirm = await screen.findByRole("alertdialog")
    await user.click(within(confirm).getByRole("button", { name: "Import" }))
    await waitFor(() => expect(posts(fn, "/backup/import/library")).toHaveLength(1))
    expect(bodyOf(posts(fn, "/backup/import/library")[0])).toEqual({ data: ENCRYPTED, password: "pw", mode: "download" })
  })
})
