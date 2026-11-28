import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppUpdateEntry } from "@/components/desktop/AppUpdateEntry"
import { enterTauri, leaveTauri } from "@/test/tauriShell"
import { flushTasks } from "@/test/settle"

let appState: { status: string; downloaded?: number; total?: number | null } = { status: "idle" }
let matchState: { status: string; version?: string; currentVersion?: string; downgrade?: boolean } = { status: "idle" }
vi.mock("@/hooks/useSettings", () => ({ useAppVersion: () => ({ data: { version: "1.5.0" } }) }))
vi.mock("@/hooks/useDesktopAppVersion", () => ({ useDesktopAppVersion: () => "1.4.0" }))
vi.mock("@/hooks/useAppUpdate", () => ({
  useAppUpdate: () => ({ state: appState, check: vi.fn(), install: vi.fn() }),
}))
vi.mock("@/hooks/useMatchServerVersion", () => ({
  useMatchServerVersion: () => ({ state: matchState, check: vi.fn(), install: vi.fn(), cancel: vi.fn() }),
}))

beforeEach(() => vi.stubGlobal("__TAURI_INTERNALS__", {}))
afterEach(() => {
  appState = { status: "idle" }
  matchState = { status: "idle" }
})

describe("AppUpdateEntry visibility", () => {
  it("renders nothing in the Android build, which has no updater", () => {
    vi.unstubAllGlobals()
    enterTauri("android")
    try {
      const { container } = render(<AppUpdateEntry allowMatch />)
      expect(container).toBeEmptyDOMElement()
    } finally {
      leaveTauri()
    }
  })

  it("renders nothing on the web", () => {
    vi.unstubAllGlobals()
    const { container } = render(<AppUpdateEntry />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("AppUpdateEntry dialog", () => {
  it("closes with Escape and shows the X when idle", async () => {
    const user = userEvent.setup()
    render(<AppUpdateEntry />)
    await user.click(screen.getByRole("button", { name: "Check for updates" }))
    expect(await screen.findByRole("dialog", { name: "App updates" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("closes on an outside click when idle", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 }) // Radix sets body pointer-events:none
    render(<AppUpdateEntry />)
    await user.click(screen.getByRole("button", { name: "Check for updates" }))
    await screen.findByRole("dialog", { name: "App updates" })
    await user.click(document.querySelector("[data-slot=dialog-overlay]")!)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("can't be closed while installing, then can once the install ends", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { rerender } = render(<AppUpdateEntry />)
    await user.click(screen.getByRole("button", { name: "Check for updates" }))
    await screen.findByRole("dialog")

    appState = { status: "installing", downloaded: 1, total: 10 }
    rerender(<AppUpdateEntry />)
    await waitFor(() => expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument())
    const dialog = () => screen.getByRole("dialog", { name: "App updates" })
    // A wrongly-allowed close flips data-state to "closed" at once, while the node can linger a tick (Radix Presence),
    // so assert on the state, and check each way of closing on its own (a close followed by a click would reopen it).
    // The X had focus and is gone, so a key press would go to <body>: dispatch Escape on the dialog itself.
    fireEvent.keyDown(dialog(), { key: "Escape" })
    await flushTasks()
    expect(dialog()).toHaveAttribute("data-state", "open")
    await user.click(document.querySelector("[data-slot=dialog-overlay]")!)
    await flushTasks()
    expect(dialog()).toHaveAttribute("data-state", "open")

    appState = { status: "error" }
    rerender(<AppUpdateEntry />)
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("an outside click on the match confirmation doesn't close the dialog behind it", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    matchState = { status: "confirm", version: "1.5.0", currentVersion: "1.4.0", downgrade: false }
    render(<AppUpdateEntry allowMatch />)
    await user.click(screen.getByRole("button", { name: "Check for updates" }))
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument()
    await user.click(document.querySelector("[data-slot=alert-dialog-overlay]")!)
    await flushTasks() // the outside click has been handled and committed
    // (aria-hidden behind the modal alert, so query by slot rather than role)
    expect(document.querySelector("[data-slot=dialog-content]")).toHaveAttribute("data-state", "open")
  })
})
