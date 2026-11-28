import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { enterTauri, leaveTauri } from "@/test/tauriShell"

vi.mock("@/hooks/useAuth", () => ({
  useAuthStatus: () => ({ data: { authenticated: true }, isError: false, refetch: vi.fn(), isFetching: false }),
}))
vi.mock("@/hooks/useDownloadToasts", () => ({ useDownloadToasts: () => {} }))
vi.mock("@/components/ConnectionBanner", () => ({ ConnectionBanner: () => null }))
vi.mock("@/components/SecurityNotice", () => ({ SecurityNotice: () => null }))
vi.mock("@/components/VersionMismatchNotice", () => ({ VersionMismatchNotice: () => <p>version notice</p> }))
vi.mock("@/components/ServerSwitcher", () => ({ ServerSwitcherMenu: () => null }))

import { DesktopGate } from "@/components/DesktopGate"

afterEach(() => {
  leaveTauri()
})

describe("DesktopGate version notice", () => {
  it("is shown in the desktop app once signed in", () => {
    enterTauri()
    render(<DesktopGate>page</DesktopGate>)
    expect(screen.getByText("page")).toBeInTheDocument()
    expect(screen.getByText("version notice")).toBeInTheDocument()
  })

  it("is not shown in the Android build, which has no app updater", () => {
    enterTauri("android")
    render(<DesktopGate>page</DesktopGate>)
    expect(screen.getByText("page")).toBeInTheDocument()
    expect(screen.queryByText("version notice")).toBeNull()
  })

  it("is not shown on the web", () => {
    render(<DesktopGate>page</DesktopGate>)
    expect(screen.queryByText("version notice")).toBeNull()
  })
})
