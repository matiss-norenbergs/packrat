import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, waitFor } from "@testing-library/react"
import { ThemeProvider } from "next-themes"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppLayout } from "@/layouts/AppLayout"
import { BrowseLayout } from "@/layouts/BrowseLayout"
import { ImmersiveLayout } from "@/layouts/ImmersiveLayout"
import { preferencesQueryKey } from "@/hooks/usePreferences"
import { markLoggedOut } from "@/hooks/useAuth"
import { callsTo, mockFetch } from "@/test/mockApi"

// The real layouts and the real useSyncAppearance run; only the websocket and the heavy chrome
// (sidebar, headers, mini player) are stubbed so each layout can render in jsdom.
vi.mock("@/hooks/useDownloadsSocket", () => ({ useDownloadsSocket: () => {} }))
vi.mock("@/components/sidebar/Sidebar", () => ({ Sidebar: () => null }))
vi.mock("@/components/sidebar/MobileNav", () => ({ MobileNav: () => null }))
vi.mock("@/components/browse/BrowseHeader", () => ({ BrowseHeader: () => null }))
vi.mock("@/components/browse/MiniPlayerDock", () => ({ MiniPlayerDock: () => null }))
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }))

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("data-accent")
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  window.scrollTo = () => {}
  Element.prototype.scrollTo = () => {}
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// A data router, like the app's: AppLayout's RevealAllProvider reads useMatches().
function renderLayout(layout: React.ReactElement, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const router = createMemoryRouter(
    [
      { element: layout, children: [{ path: "/x", element: <div>page</div> }] },
      { path: "/login", element: <div>login page</div> },
    ],
    { initialEntries: ["/x"] },
  )
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

const server = (authenticated: boolean) =>
  mockFetch((url) => {
    if (url.endsWith("/auth/status")) return { status: 200, body: { setupRequired: false, authenticated } }
    if (url.endsWith("/auth/preferences")) return { status: 200, body: { theme: "dark", accent: "green" } }
    return { status: 404 }
  })

describe.each([
  ["AppLayout", () => <AppLayout />],
  ["BrowseLayout", () => <BrowseLayout />],
  ["ImmersiveLayout", () => <ImmersiveLayout />],
])("%s", (_name, makeLayout) => {
  it("fetches the preferences and applies them when signed in", async () => {
    const fetchMock = server(true)
    renderLayout(makeLayout())
    await waitFor(() => expect(document.documentElement.getAttribute("data-accent")).toBe("green"))
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true))
    expect(callsTo(fetchMock, "/auth/preferences")).toHaveLength(1)
  })

  it("requests no preferences when signed out", async () => {
    const fetchMock = server(false)
    const { findByText } = renderLayout(makeLayout())
    await findByText("login page")
    expect(callsTo(fetchMock, "/auth/preferences")).toHaveLength(0)
  })
})

describe("logout", () => {
  it("drops the cached preferences so the next account's are fetched and applied", () => {
    const client = new QueryClient()
    client.setQueryData(preferencesQueryKey, { theme: "dark", accent: "red" })
    markLoggedOut(client)
    expect(client.getQueryData(preferencesQueryKey)).toBeUndefined()
  })
})
