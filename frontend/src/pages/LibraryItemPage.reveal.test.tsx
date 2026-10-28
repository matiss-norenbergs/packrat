import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Link, Outlet, RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FloatingActionDock } from "@/components/FloatingActionDock"
import { RevealAllProvider, useRevealAll } from "@/components/library/RevealAllContext"
import { RevealAllFloatingAction } from "@/components/library/RevealAllFloatingAction"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LibraryItemPage } from "@/pages/LibraryItemPage"
import { mockFetch } from "@/test/mockApi"

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  window.HTMLMediaElement.prototype.play = () => Promise.resolve()
  window.HTMLMediaElement.prototype.pause = () => {}
  window.HTMLMediaElement.prototype.load = () => {}
  mockFetch(serve)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function item(id: number) {
  return {
    id,
    downloadId: id,
    title: `Item ${id}`,
    filename: `item${id}.mp4`,
    path: `c/item${id}.mp4`,
    collectionId: 1,
    collectionName: "Private",
    folder: "c",
    originalUrl: null,
    uploader: null,
    duration: 60,
    resolution: null,
    mediaType: "video",
    thumbnail: null,
    thumbnailSmallPath: null,
    thumbnailMediumPath: null,
    description: null,
    tags: [],
    status: "available",
    blurred: true,
    downloadedAt: "2026-01-01T00:00:00Z",
    generateNfo: false,
    nfoExists: false,
    galleryCount: 0,
    fileSizeBytes: null,
    playbackPositionSeconds: null,
    lastWatchedAt: null,
  }
}
const ITEMS = [item(1), item(2), item(3)]

function serve(url: string) {
  if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: true } }
  if (url.endsWith("/collections")) return { status: 200, body: [{ id: 1, effectiveIsPrivate: true, totalItemCount: 3 }] }
  if (url.endsWith("/tags")) return { status: 200, body: [] }
  const single = url.match(/\/library\/(\d+)$/)
  if (single) return { status: 200, body: ITEMS.find((i) => i.id === Number(single[1])) }
  if (url.includes("/library?")) return { status: 200, body: { items: ITEMS, total: 3 } }
  return { status: 404 }
}

// Stand-in for the Library / Compare list: reads the shared state and shows the floating button.
function LibraryStandIn() {
  const { revealAll, isRevealed, toggleItem } = useRevealAll()
  return (
    <div>
      <RevealAllFloatingAction />
      <span data-testid="lib-all">{revealAll ? "on" : "off"}</span>
      <span data-testid="lib-shown">{[1, 2, 3].filter(isRevealed).join(",") || "none"}</span>
      <button onClick={() => toggleItem(1)}>reveal-card-1</button>
      <Link to="/library/1">open1</Link>
    </div>
  )
}

// Rendered outside the item page, inside the shared provider.
function Probe() {
  const { revealAll } = useRevealAll()
  return <span data-testid="probe">{revealAll ? "on" : "off"}</span>
}

function renderApp() {
  const router = createMemoryRouter(
    [
      {
        element: (
          <RevealAllProvider clearOnNavigate>
            <FloatingActionDock>
              <Probe />
              <Outlet />
            </FloatingActionDock>
          </RevealAllProvider>
        ),
        children: [
          { path: "/library", element: <LibraryStandIn /> },
          { path: "/library/:id", element: <LibraryItemPage /> },
        ],
      },
    ],
    { initialEntries: ["/library"] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return router
}

const fab = () => screen.queryByRole("button", { name: /private items/ })
const probe = () => screen.getByTestId("probe").textContent
const lockedPanel = () => screen.queryByText("This item is private")
const strip = () => screen.queryAllByRole("link", { name: "Item 2" })[0]

async function openFromLibraryWithRevealAllOn() {
  const router = renderApp()
  await userEvent.click(await screen.findByRole("button", { name: "Reveal all private items" }))
  expect(probe()).toBe("on")
  await userEvent.click(screen.getByRole("link", { name: "open1" }))
  await waitFor(() => expect(lockedPanel()).toBeTruthy())
  return router
}

describe("LibraryItemPage reveal state", () => {
  it("opens a private item locked with no floating button, even with reveal-all on", async () => {
    await openFromLibraryWithRevealAllOn()
    expect(fab()).toBeNull()
  })

  it("reveals the item and its strip on click, and keeps them through strip navigation", async () => {
    await openFromLibraryWithRevealAllOn()
    expect(strip()).toBeUndefined()
    await userEvent.click(lockedPanel()!)
    expect(lockedPanel()).toBeNull()
    await userEvent.click((await screen.findAllByRole("link", { name: "Item 2" }))[0])
    await waitFor(() => expect(screen.getByRole("heading", { name: "Item 2" })).toBeTruthy())
    expect(lockedPanel()).toBeNull()
    expect(screen.getAllByRole("link", { name: "Item 3" }).length).toBeGreaterThan(0)
  })

  it("is locked again after leaving the page and coming back", async () => {
    const router = await openFromLibraryWithRevealAllOn()
    await userEvent.click(lockedPanel()!)
    await router.navigate("/library")
    await userEvent.click(await screen.findByRole("link", { name: "open1" }))
    await waitFor(() => expect(lockedPanel()).toBeTruthy())
  })

  it("switches the shared reveal-all off once on open, not again on strip navigation", async () => {
    const router = await openFromLibraryWithRevealAllOn()
    expect(probe()).toBe("off")
    await userEvent.click(lockedPanel()!)
    await userEvent.click((await screen.findAllByRole("link", { name: "Item 2" }))[0])
    await waitFor(() => expect(screen.getByRole("heading", { name: "Item 2" })).toBeTruthy())
    expect(probe()).toBe("off")
    await router.navigate("/library")
    expect(await screen.findByTestId("lib-all")).toBeTruthy()
    expect(screen.getByTestId("lib-all").textContent).toBe("off")
    expect(screen.getByTestId("lib-shown").textContent).toBe("none")
    expect(await screen.findByRole("button", { name: "Reveal all private items" })).toBeTruthy()
  })
})
