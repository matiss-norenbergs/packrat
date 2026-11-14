import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppUpdatePanel } from "@/components/desktop/AppUpdatePanel"

let serverVersion: string | undefined
vi.mock("@/hooks/useSettings", () => ({
  useAppVersion: () => ({ data: serverVersion ? { version: serverVersion } : undefined }),
}))
vi.mock("@/hooks/useDesktopAppVersion", () => ({ useDesktopAppVersion: () => "1.4.0" }))
vi.mock("@/hooks/useAppUpdate", () => ({
  useAppUpdate: () => ({ state: { status: "idle" }, check: vi.fn(), install: vi.fn() }),
}))
vi.mock("@/hooks/useMatchServerVersion", () => ({
  useMatchServerVersion: () => ({ state: { status: "idle" }, check: vi.fn(), install: vi.fn(), cancel: vi.fn() }),
}))

afterEach(cleanup)

describe("AppUpdatePanel", () => {
  it("always offers Check for updates", () => {
    serverVersion = undefined
    render(<AppUpdatePanel serverName="Home" />)
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument()
  })

  it.each([undefined, "dev", "1.5.0-rc1-dirty-build"])("hides Match when the server version is %s", (v) => {
    serverVersion = v
    render(<AppUpdatePanel serverName="Home" />)
    expect(screen.queryByRole("button", { name: /^Match/ })).not.toBeInTheDocument()
  })

  it("hides Match when it isn't allowed", () => {
    serverVersion = "1.5.0"
    render(<AppUpdatePanel allowMatch={false} />)
    expect(screen.queryByRole("button", { name: /^Match/ })).not.toBeInTheDocument()
  })

  it("names the server on Match when a release version resolves", () => {
    serverVersion = "1.5.0"
    render(<AppUpdatePanel serverName="Home" />)
    expect(screen.getByRole("button", { name: "Match Home (v1.5.0)" })).toBeInTheDocument()
  })

  it("keeps the generic Settings wording without a server name", () => {
    serverVersion = "1.5.0"
    render(<AppUpdatePanel />)
    expect(screen.getByRole("button", { name: "Match server version" })).toBeInTheDocument()
  })

  it("says it matches when the versions agree", () => {
    serverVersion = "1.4.0"
    render(<AppUpdatePanel serverName="Home" />)
    expect(screen.getByText("Matches Home.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Match/ })).not.toBeInTheDocument()
  })
})
