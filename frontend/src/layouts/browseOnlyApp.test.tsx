import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppLayout } from "@/layouts/AppLayout"
import { BrowseLayout } from "@/layouts/BrowseLayout"
import { ImmersiveLayout } from "@/layouts/ImmersiveLayout"
import { RouteError } from "@/components/RouteError"
import { mockFetch } from "@/test/mockApi"
import { enterTauri, leaveTauri } from "@/test/tauriShell"

// The Android app's Browse-only gate: the real layouts and RouteError in a router shaped like the
// app's (routes/index.tsx); only the chrome and the websocket are stubbed so jsdom can render them.
vi.mock("@/hooks/useDownloadsSocket", () => ({ useDownloadsSocket: () => {} }))
vi.mock("@/components/sidebar/Sidebar", () => ({ Sidebar: () => null }))
vi.mock("@/components/sidebar/MobileNav", () => ({ MobileNav: () => null }))
vi.mock("@/components/browse/BrowseHeader", () => ({ BrowseHeader: () => null }))
vi.mock("@/components/browse/MiniPlayerDock", () => ({ MiniPlayerDock: () => null }))
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  window.scrollTo = () => {}
  Element.prototype.scrollTo = () => {}
  mockFetch((url) =>
    url.endsWith("/auth/status") ? { status: 200, body: { setupRequired: false, authenticated: true } } : { status: 404 },
  )
})
afterEach(() => {
  leaveTauri()
})

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/login", errorElement: <RouteError />, element: <div>login page</div> },
      {
        element: <AppLayout />,
        errorElement: <RouteError />,
        children: [
          { path: "/", element: <div>dashboard page</div> },
          { path: "/settings", element: <div>settings page</div> },
        ],
      },
      { element: <BrowseLayout />, errorElement: <RouteError />, children: [{ path: "/browse", element: <div>browse page</div> }] },
      { element: <ImmersiveLayout />, errorElement: <RouteError />, children: [{ path: "/compare-list/play", element: <div>compare page</div> }] },
    ],
    { initialEntries: [path] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

describe("Android app (Browse-only)", () => {
  beforeEach(() => enterTauri("android"))

  it.each(["/", "/settings", "/compare-list/play", "/no-such-page"])("redirects %s to /browse", async (path) => {
    const router = renderAt(path)
    expect(await screen.findByText("browse page")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/browse")
    // A replace, so the back gesture can't return to the admin route.
    expect(router.state.historyAction).toBe("REPLACE")
  })

  it("leaves /login alone", async () => {
    const router = renderAt("/login")
    expect(await screen.findByText("login page")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/login")
  })

  it("still sends a signed-out user from /browse to /login", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/status") ? { status: 200, body: { setupRequired: false, authenticated: false } } : { status: 404 },
    )
    const router = renderAt("/")
    expect(await screen.findByText("login page")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/login")
  })
})

describe.each([
  ["web", () => {}],
  ["desktop app", () => enterTauri("desktop")],
])("%s (unchanged)", (_name, enter) => {
  beforeEach(() => enter())

  it("shows the Dashboard at /", async () => {
    renderAt("/")
    expect(await screen.findByText("dashboard page")).toBeInTheDocument()
  })

  it("shows admin pages", async () => {
    renderAt("/settings")
    expect(await screen.findByText("settings page")).toBeInTheDocument()
  })

  it("shows the error page for an unknown path", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    renderAt("/no-such-page")
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument()
  })
})
