import { cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HistoryTab } from "@/components/settings/tabs/HistoryTab"
import { bodyOf, callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Settings } from "@/types/api"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function fakeServer(initial: Partial<Settings> = {}) {
  let stored = {
    historyAnonymizeUrls: false,
    historyRetentionDays: 0,
    featureSystemEventsEnabled: true,
    systemEventsRetentionCount: 0,
    ...initial,
  } as Settings
  const fn = mockFetch((url, init) => {
    const path = url.replace(/^.*\/api/, "")
    if (path === "/settings") {
      if (init.method === "PATCH") {
        stored = { ...stored, ...JSON.parse(init.body as string) }
        return { status: 200, body: {} }
      }
      return { status: 200, body: stored }
    }
    if (path === "/system-events/facets") {
      return {
        status: 200,
        body: { levels: [{ value: "info", count: 40 }, { value: "error", count: 2 }], categories: [{ value: "startup", count: 42 }] },
      }
    }
    if (path === "/system-events" && init.method === "DELETE") return { status: 200, body: { deleted: 42 } }
    return { status: 404 }
  })
  return fn
}

const patches = (fn: ReturnType<typeof mockFetch>) => callsTo(fn, "/settings").filter(([, init]) => (init as RequestInit).method === "PATCH")

describe("HistoryTab — System log card", () => {
  it("shows the stored values with nothing to save", async () => {
    fakeServer({ systemEventsRetentionCount: 5000 })
    renderWithProviders(<HistoryTab />)
    const toggle = await screen.findByRole("checkbox", { name: "Record system events" })
    expect(toggle).toBeChecked()
    expect(screen.getByRole("combobox", { name: /Keep the last/ })).toHaveTextContent("5,000 events")
    expect(screen.getByText("No changes")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("sends the switch and the retention count, only what changed, through the shared Save", async () => {
    const fn = fakeServer()
    renderWithProviders(<HistoryTab />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole("checkbox", { name: "Record system events" }))
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
    await user.click(screen.getByRole("combobox", { name: /Keep the last/ }))
    await user.click(await screen.findByRole("option", { name: "1,000 events" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument())
    expect(patches(fn)).toHaveLength(1)
    expect(bodyOf(patches(fn)[0])).toEqual({ featureSystemEventsEnabled: false, systemEventsRetentionCount: 1000 })
    // The saved state is the new baseline: nothing left to save, and the card now explains the log is off.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    expect(await screen.findByText(/Turn the log on and save/)).toBeInTheDocument()
  })

  it("offers every preset including Unlimited, and saves 0 for Unlimited", async () => {
    const fn = fakeServer({ systemEventsRetentionCount: 500 })
    renderWithProviders(<HistoryTab />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("combobox", { name: /Keep the last/ }))
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["500 events", "1,000 events", "5,000 events", "10,000 events", "Unlimited"])
    await user.click(screen.getByRole("option", { name: "Unlimited" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(bodyOf(patches(fn)[0])).toEqual({ systemEventsRetentionCount: 0 })
  })

  it("Clear all now confirms with the stored count, deletes everything at once and is not part of Save", async () => {
    const fn = fakeServer()
    renderWithProviders(<HistoryTab />)
    const user = userEvent.setup()

    expect(await screen.findByText(/42 stored/)).toBeInTheDocument()
    const clearButtons = screen.getAllByRole("button", { name: "Clear all now" })
    // The history card's own button comes first; the System log card's is the second.
    await user.click(clearButtons[1])
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Delete all 42 system events?")).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(callsTo(fn, "/system-events").filter(([, init]) => (init as RequestInit).method === "DELETE")).toHaveLength(0)

    await user.click(clearButtons[1])
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete all" }))
    await waitFor(() => {
      const deletes = callsTo(fn, "/system-events").filter(([, init]) => (init as RequestInit).method === "DELETE")
      expect(deletes).toHaveLength(1)
      expect(bodyOf(deletes[0])).toEqual({ all: true })
    })
    expect(patches(fn)).toHaveLength(0)
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("disables Clear all now while the log is off", async () => {
    fakeServer({ featureSystemEventsEnabled: false })
    renderWithProviders(<HistoryTab />)
    await screen.findByRole("checkbox", { name: "Record system events" })
    expect(screen.getAllByRole("button", { name: "Clear all now" })[1]).toBeDisabled()
    expect(screen.getByText(/Turn the log on and save/)).toBeInTheDocument()
  })
})
