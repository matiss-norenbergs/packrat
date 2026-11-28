import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { enterTauri, leaveTauri } from "@/test/tauriShell"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.0.0" }))
vi.mock("@/components/settings/ServersSection", () => ({ ServersSection: () => <p>servers</p> }))
vi.mock("@/components/desktop/AppUpdatePanel", () => ({ AppUpdatePanel: () => <p>updates</p> }))
vi.mock("@/hooks/useSettings", () => ({ useAppVersion: () => ({ data: { version: "1.0.0" } }) }))

import { DesktopTab } from "@/components/settings/tabs/DesktopTab"
import { flushTasks } from "@/test/settle"

beforeEach(() => invoke.mockReset().mockResolvedValue(false))
afterEach(() => {
  leaveTauri()
})

describe("DesktopTab", () => {
  it("shows the shell settings in the desktop app", async () => {
    enterTauri()
    render(<DesktopTab />)
    expect(screen.getByText("servers")).toBeInTheDocument()
    expect(screen.getByText("Window and startup")).toBeInTheDocument()
    expect(screen.getByText("updates")).toBeInTheDocument()
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_close_to_tray"))
  })

  it("shows only the server list in the Android build and calls no desktop command", async () => {
    enterTauri("android")
    render(<DesktopTab />)
    expect(screen.getByText("servers")).toBeInTheDocument()
    expect(screen.queryByText("Window and startup")).toBeNull()
    expect(screen.queryByText("updates")).toBeNull()
    await flushTasks()
    expect(invoke).not.toHaveBeenCalled()
  })
})
