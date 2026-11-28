import { fireEvent, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SystemLogView } from "@/components/logs/SystemLogView"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { SystemEvent } from "@/types/api"

const event = (id: number, message: string): SystemEvent => ({
  id,
  createdAt: "2026-11-01T10:00:00Z",
  level: "info",
  category: "backup",
  message,
  details: { n: id },
})
const EVENTS = [event(1, "Server started"), event(2, "Backup finished"), event(3, "Migration applied")]

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  window.HTMLElement.prototype.hasPointerCapture = vi.fn()
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  mockFetch((url) => {
    if (url.includes("/system-events/facets")) return { status: 200, body: { levels: [], categories: [] } }
    if (url.includes("/system-events")) return { status: 200, body: { items: EVENTS, total: EVENTS.length } }
    return { status: 200, body: {} }
  })
})

const renderLog = () =>
  renderWithProviders(
    <TooltipProvider>
      <SystemLogView />
    </TooltipProvider>,
    "/logs?view=system",
  )
const rowCheckbox = (message: string) => screen.findByRole("checkbox", { name: new RegExp(`^Select event \\d+: ${message}$`) })

describe("System log: View details button", () => {
  it("is disabled with no row selected and sits left of Delete with the other toolbar actions", async () => {
    renderLog()
    await rowCheckbox("Server started")
    const view = screen.getByRole("button", { name: "View details" })
    expect(view).toBeDisabled()
    const delet = screen.getByRole("button", { name: "Delete" })
    expect(view.compareDocumentPosition(delet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("opens the details dialog of the one selected row", async () => {
    const user = userEvent.setup()
    renderLog()
    await user.click(await rowCheckbox("Backup finished"))
    const view = screen.getByRole("button", { name: "View details" })
    expect(view).toBeEnabled()
    await user.click(view)
    expect(await screen.findByRole("dialog", { name: "Backup finished" })).toBeTruthy()
  })

  it("is disabled again when several rows are selected", async () => {
    const user = userEvent.setup()
    renderLog()
    await user.click(await rowCheckbox("Server started"))
    await user.click(await rowCheckbox("Backup finished"))
    expect(screen.getByRole("button", { name: "View details" })).toBeDisabled()
    await user.click(await rowCheckbox("Backup finished"))
    expect(screen.getByRole("button", { name: "View details" })).toBeEnabled()
  })

  it("still opens the dialog on a double click of a row", async () => {
    renderLog()
    await rowCheckbox("Migration applied")
    fireEvent.doubleClick(screen.getByText("Migration applied"))
    expect(await screen.findByRole("dialog", { name: "Migration applied" })).toBeTruthy()
  })

  it("still offers View details in the row's context menu", async () => {
    renderLog()
    await rowCheckbox("Server started")
    fireEvent.contextMenu(screen.getByText("Server started"))
    const item = await screen.findByRole("menuitem", { name: "View details" })
    fireEvent.click(item)
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Server started" })).toBeTruthy())
  })
})
