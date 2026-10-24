import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DownloadsSection } from "@/components/settings/DownloadsSection"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

// A stand-in shell: the two download settings and a folder picker that answers `picked`.
function shell(initial: { ask: boolean; folder: { path: string; isDefault: boolean } }, picked: string | null = null) {
  const state = { ...initial }
  invoke.mockImplementation(async (cmd: string, args?: { enabled: boolean }) => {
    if (cmd === "get_ask_where_to_save") return state.ask
    if (cmd === "set_ask_where_to_save") state.ask = args!.enabled
    if (cmd === "get_download_folder") return state.folder
    if (cmd === "choose_download_folder") {
      if (picked) state.folder = { path: picked, isDefault: false }
      return picked ? state.folder : null
    }
    if (cmd === "reset_download_folder") {
      state.folder = { path: "/home/me/Downloads", isDefault: true }
      return state.folder
    }
  })
  return state
}

const DEFAULT = { path: "/home/me/Downloads", isDefault: true }

beforeEach(() => invoke.mockReset())
afterEach(cleanup)

describe("DownloadsSection", () => {
  it("is off by default and shows the OS Downloads folder", async () => {
    shell({ ask: false, folder: DEFAULT })
    render(<DownloadsSection />)
    expect(await screen.findByText("/home/me/Downloads")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Ask where to save each download" })).not.toBeChecked()
    expect(screen.getByRole("button", { name: /Change…/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Use default" })).toBeNull()
  })

  it("turning the switch on is saved in the shell", async () => {
    const state = shell({ ask: false, folder: DEFAULT })
    render(<DownloadsSection />)
    const toggle = screen.getByRole("switch", { name: "Ask where to save each download" })
    await waitFor(() => expect(toggle).toBeEnabled())
    await userEvent.setup().click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    expect(state.ask).toBe(true)
    expect(invoke).toHaveBeenCalledWith("set_ask_where_to_save", { enabled: true })
  })

  it("Change… opens the folder picker and shows the chosen folder, with a way back", async () => {
    shell({ ask: false, folder: DEFAULT }, "/media/videos")
    render(<DownloadsSection />)
    const user = userEvent.setup()
    await screen.findByText("/home/me/Downloads")
    await user.click(screen.getByRole("button", { name: /Change…/ }))
    expect(await screen.findByText("/media/videos")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Use default" }))
    expect(await screen.findByText("/home/me/Downloads")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Use default" })).toBeNull()
  })

  it("keeps the folder when the picker is dismissed", async () => {
    shell({ ask: false, folder: DEFAULT }, null)
    render(<DownloadsSection />)
    await screen.findByText("/home/me/Downloads")
    await userEvent.setup().click(screen.getByRole("button", { name: /Change…/ }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("choose_download_folder"))
    expect(screen.getByText("/home/me/Downloads")).toBeInTheDocument()
  })
})
