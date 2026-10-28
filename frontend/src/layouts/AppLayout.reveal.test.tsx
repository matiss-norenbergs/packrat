import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "next-themes"
import { Link, MemoryRouter, Route, Routes } from "react-router-dom"
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

const IDS = [1, 2, 3]

function Page({ name, to }: { name: string; to: string }) {
  const { isRevealed, toggleItem, revealItems, toggleRevealAll } = useRevealAll()
  return (
    <div>
      <span data-testid={name}>{IDS.filter(isRevealed).join(",") || "none"}</span>
      <button onClick={() => { toggleItem(1); revealItems([2, 3]) }}>reveal</button>
      <button onClick={toggleRevealAll}>all</button>
      <Link to={to}>go</Link>
    </div>
  )
}

function renderApp() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <MemoryRouter initialEntries={["/library/1"]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/library/:id" element={<Page name="item" to="/library" />} />
              <Route path="/library" element={<Page name="library" to="/library/1" />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

const click = (name: string) => userEvent.click(screen.getByRole("button", { name }))

describe("AppLayout reveal state across navigation", () => {
  it("re-blurs an item and its siblings revealed on the item page once the user leaves it", async () => {
    renderApp()
    await waitFor(() => expect(screen.getByTestId("item")).toBeTruthy())
    await click("reveal")
    expect(screen.getByTestId("item").textContent).toBe("1,2,3")
    await userEvent.click(screen.getByRole("link", { name: "go" }))
    expect(screen.getByTestId("library").textContent).toBe("none")
  })

  it("keeps everything revealed on both pages while reveal-all is on", async () => {
    renderApp()
    await waitFor(() => expect(screen.getByTestId("item")).toBeTruthy())
    await click("all")
    expect(screen.getByTestId("item").textContent).toBe("1,2,3")
    await userEvent.click(screen.getByRole("link", { name: "go" }))
    expect(screen.getByTestId("library").textContent).toBe("1,2,3")
  })
})
