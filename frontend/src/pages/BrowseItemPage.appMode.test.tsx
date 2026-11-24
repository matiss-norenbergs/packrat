import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MiniPlayerProvider } from "@/components/browse/MiniPlayerContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { BrowseItemPage } from "@/pages/BrowseItemPage"
import { mockFetch } from "@/test/mockApi"
import { enterTauri, leaveTauri } from "@/test/tauriShell"

// The menu itself (edit details, delete, …) is covered elsewhere; here only whether it's offered.
vi.mock("@/components/library/LibraryItemActionsMenu", () => ({
  LibraryItemActionsMenu: () => <button type="button">item actions</button>,
}))

const ITEM = {
  id: 1,
  downloadId: 1,
  title: "Item 1",
  filename: "item1.mp4",
  path: "c/item1.mp4",
  collectionId: null,
  collectionName: null,
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
  blurred: false,
  downloadedAt: "2026-01-01T00:00:00Z",
  generateNfo: false,
  nfoExists: false,
  galleryCount: 0,
  activeDownloadId: null,
  fileSizeBytes: null,
  playbackPositionSeconds: null,
  lastWatchedAt: null,
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  window.HTMLMediaElement.prototype.play = () => Promise.resolve()
  window.HTMLMediaElement.prototype.pause = () => {}
  window.HTMLMediaElement.prototype.load = () => {}
  mockFetch((url) => {
    if (url.endsWith("/library/1")) return { status: 200, body: ITEM }
    if (url.endsWith("/settings")) return { status: 200, body: { libraryAutoplay: false } }
    if (url.endsWith("/tags") || url.endsWith("/artists")) return { status: 200, body: [] }
    return { status: 404 }
  })
})
afterEach(() => {
  cleanup()
  leaveTauri()
  vi.unstubAllGlobals()
})

function renderItemPage() {
  const router = createMemoryRouter([{ path: "/browse/:id", element: <BrowseItemPage /> }], { initialEntries: ["/browse/1"] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <MiniPlayerProvider>
          <RouterProvider router={router} />
        </MiniPlayerProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

describe("BrowseItemPage actions menu", () => {
  it("is hidden in the Android app", async () => {
    enterTauri("android")
    renderItemPage()
    expect(await screen.findByRole("heading", { name: "Item 1" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "item actions" })).toBeNull()
  })

  it.each([
    ["web", () => {}],
    ["desktop app", () => enterTauri("desktop")],
  ])("is shown on the %s", async (_name, enter) => {
    enter()
    renderItemPage()
    expect(await screen.findByRole("heading", { name: "Item 1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "item actions" })).toBeInTheDocument()
  })
})
