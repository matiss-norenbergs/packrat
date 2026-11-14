import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppUpdatePanel } from "@/components/desktop/AppUpdatePanel"

let serverVersion: string | undefined
let appState: { status: string; downloaded?: number; total?: number | null } = { status: "idle" }
let matchState: { status: string; downloaded?: number; total?: number | null } = { status: "idle" }
vi.mock("@/hooks/useSettings", () => ({
  useAppVersion: () => ({ data: serverVersion ? { version: serverVersion } : undefined }),
}))
vi.mock("@/hooks/useDesktopAppVersion", () => ({ useDesktopAppVersion: () => "1.4.0" }))
vi.mock("@/hooks/useAppUpdate", () => ({
  useAppUpdate: () => ({ state: appState, check: vi.fn(), install: vi.fn() }),
}))
vi.mock("@/hooks/useMatchServerVersion", () => ({
  useMatchServerVersion: () => ({ state: matchState, check: vi.fn(), install: vi.fn(), cancel: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  appState = { status: "idle" }
  matchState = { status: "idle" }
})

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

  describe("onInstallingChange", () => {
    it.each([
      ["app update", () => (appState = { status: "installing", downloaded: 1, total: 10 })],
      ["match update", () => (matchState = { status: "installing", downloaded: 1, total: 10 })],
    ])("reports an installing %s and then its end", (_name, startInstall) => {
      serverVersion = undefined
      const onChange = vi.fn()
      const { rerender } = render(<AppUpdatePanel onInstallingChange={onChange} />)
      expect(onChange).toHaveBeenLastCalledWith(false)

      startInstall()
      rerender(<AppUpdatePanel onInstallingChange={onChange} />)
      expect(onChange).toHaveBeenLastCalledWith(true)

      appState = { status: "error" }
      matchState = { status: "idle" }
      rerender(<AppUpdatePanel onInstallingChange={onChange} />)
      expect(onChange).toHaveBeenLastCalledWith(false)
    })

    it("reports false when it unmounts mid-install", () => {
      serverVersion = undefined
      appState = { status: "installing", downloaded: 0, total: null }
      const onChange = vi.fn()
      const { unmount } = render(<AppUpdatePanel onInstallingChange={onChange} />)
      expect(onChange).toHaveBeenLastCalledWith(true)
      unmount()
      expect(onChange).toHaveBeenLastCalledWith(false)
    })
  })
})
