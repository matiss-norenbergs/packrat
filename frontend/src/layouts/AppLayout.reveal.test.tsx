import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "next-themes"
import { Link, RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useRevealAll } from "@/components/library/RevealAllContext"
import { AppLayout } from "@/layouts/AppLayout"
import { mockFetch } from "@/test/mockApi"

// Real AppLayout (and its real shared RevealAllProvider); only the websocket and heavy chrome are stubbed.
vi.mock("@/hooks/useDownloadsSocket", () => ({ useDownloadsSocket: () => {} }))
vi.mock("@/components/sidebar/Sidebar", () => ({ Sidebar: () => null }))
vi.mock("@/components/sidebar/MobileNav", () => ({ MobileNav: () => null }))
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  window.scrollTo = () => {}
  Element.prototype.scrollTo = () => {}
  mockFetch((url) => {
    if (url.endsWith("/auth/status")) return { status: 200, body: { setupRequired: false, authenticated: true } }
    if (url.endsWith("/auth/preferences")) return { status: 200, body: { theme: "dark", accent: "green" } }
    return { status: 404 }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The stand-in "item" page reads the shared provider to exercise its same-route/clearOnNavigate semantics.
// The real LibraryItemPage owns its own provider instead; see pages/LibraryItemPage.reveal.test.tsx.
const IDS = [1, 2, 3]

function Page({ name }: { name: string }) {
  const { isRevealed, toggleItem, revealItems, toggleRevealAll } = useRevealAll()
  return (
    <div>
      <span data-testid={name}>{IDS.filter(isRevealed).join(",") || "none"}</span>
      <button onClick={() => { toggleItem(1); revealItems([2, 3]) }}>reveal</button>
      <button onClick={toggleRevealAll}>all</button>
      <Link to="/library">library</Link>
      <Link to="/library/2">sibling</Link>
      <Link to="/compare-list">compare</Link>
    </div>
  )
}

function renderApp() {
  const router = createMemoryRouter(
    [
      {
        element: <AppLayout />,
        children: [
          { path: "/library/:id", element: <Page name="item" /> },
          { path: "/library", element: <Page name="library" /> },
          { path: "/compare-list", element: <Page name="compare" /> },
        ],
      },
    ],
    { initialEntries: ["/library/1"] },
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

const click = (name: string) => userEvent.click(screen.getByRole("button", { name }))

const link = (name: string) => userEvent.click(screen.getByRole("link", { name }))
const ready = () => waitFor(() => expect(screen.getByTestId("item")).toBeTruthy())

describe("AppLayout reveal state across navigation", () => {
  it("keeps the item and its siblings revealed when clicking through the strip (same route)", async () => {
    renderApp()
    await ready()
    await click("reveal")
    await link("sibling")
    expect(screen.getByTestId("item").textContent).toBe("1,2,3")
  })

  it("re-blurs the item and its siblings once the user leaves the item page", async () => {
    renderApp()
    await ready()
    await click("reveal")
    expect(screen.getByTestId("item").textContent).toBe("1,2,3")
    await link("library")
    expect(screen.getByTestId("library").textContent).toBe("none")
  })

  it("re-blurs when moving from the library to another page", async () => {
    renderApp()
    await ready()
    await link("library")
    await click("reveal")
    await link("compare")
    expect(screen.getByTestId("compare").textContent).toBe("none")
  })

  it("keeps everything revealed on every page while reveal-all is on", async () => {
    renderApp()
    await ready()
    await click("all")
    await link("sibling")
    expect(screen.getByTestId("item").textContent).toBe("1,2,3")
    await link("library")
    expect(screen.getByTestId("library").textContent).toBe("1,2,3")
    await link("compare")
    expect(screen.getByTestId("compare").textContent).toBe("1,2,3")
  })
})
