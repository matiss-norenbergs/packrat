import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GeneralTab } from "@/components/settings/tabs/GeneralTab"
import { bodyOf, callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Settings } from "@/types/api"

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) } }))

// A fake server: PATCH merges into the stored settings, clamping max concurrent downloads to 8
// like the backend normalizes it; GET returns what is stored.
function fakeServer() {
  let stored = {
    downloadDirectory: "/media",
    maxConcurrentDownloads: 2,
    maxConcurrentTranscodes: 2,
    downloadTimeoutMinutes: 0,
  } as Settings
  const fn = mockFetch((url, init) => {
    if (!url.endsWith("/settings")) return { status: 404 }
    if (init.method === "PATCH") {
      const patch = JSON.parse(init.body as string)
      stored = { ...stored, ...patch, ...(patch.maxConcurrentDownloads ? { maxConcurrentDownloads: Math.min(patch.maxConcurrentDownloads, 8) } : {}) }
      return { status: 200, body: {} }
    }
    return { status: 200, body: stored }
  })
  return fn
}

beforeEach(() => {
  toastError.mockReset()
  toastSuccess.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("GeneralTab", () => {
  it("loads the stored values with nothing to save", async () => {
    fakeServer()
    renderWithProviders(<GeneralTab />)

    expect(await screen.findByLabelText("Max Concurrent Downloads")).toHaveValue(2)
    expect(screen.getByText("No changes")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("edit -> Save enabled -> save -> Saved, sending only the changed field and showing the stored value", async () => {
    const fetchMock = fakeServer()
    renderWithProviders(<GeneralTab />)
    const user = userEvent.setup()

    const input = await screen.findByLabelText("Max Concurrent Downloads")
    await user.clear(input)
    await user.type(input, "50")
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
    const save = screen.getByRole("button", { name: "Save" })
    expect(save).toBeEnabled()

    await user.click(save)

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument())
    const patches = callsTo(fetchMock, "/settings").filter(([, init]) => (init as RequestInit).method === "PATCH")
    expect(patches).toHaveLength(1)
    expect(bodyOf(patches[0])).toEqual({ maxConcurrentDownloads: 50 })
    expect(toastSuccess).toHaveBeenCalledWith("Settings saved")
    // The server stored 8, not what was typed.
    expect(screen.getByLabelText("Max Concurrent Downloads")).toHaveValue(8)
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("shows an error with Retry instead of a skeleton when the settings can't be loaded", async () => {
    let healthy = false
    mockFetch(() => (healthy ? { status: 200, body: { downloadDirectory: "/media", maxConcurrentDownloads: 2, maxConcurrentTranscodes: 2, downloadTimeoutMinutes: 0 } } : { status: 500 }))
    renderWithProviders(<GeneralTab />)

    expect(await screen.findByRole("alert")).toBeInTheDocument()
    healthy = true
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByLabelText("Max Concurrent Downloads")).toHaveValue(2)
  })
})
