import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { downloadsQueryKey } from "@/hooks/useDownloads"
import { ThumbCell } from "./LibraryListView"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { LibraryItem } from "@/types/api"
import { LibraryCard } from "./LibraryCard"
import { RevealAllProvider } from "./RevealAllContext"
import { SelectionProvider } from "./SelectionContext"

vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ data: { privacyBlurStrength: "default" } }) }))
vi.mock("@/hooks/useTagNameMask", () => ({ useTagNameMask: () => (t: { name: string }) => t.name }))
vi.mock("@/hooks/useArtistNameMask", () => ({ useArtistNameMask: () => (n: string) => n }))
vi.mock("./LibraryItemActionsMenu", () => ({ LibraryItemActionsMenu: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 1,
    title: "T",
    filename: "f.mp4",
    path: "media/f.mp4",
    mediaType: "video",
    thumbnail: "thumbs/t.jpg",
    thumbnailMediumPath: null,
    blurred: false,
    tags: [],
    status: "ready",
    ...over,
  } as unknown as LibraryItem
}

function withClient(client: QueryClient, ui: React.ReactNode) {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

function newClient(downloads?: unknown[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (downloads) client.setQueryData(downloadsQueryKey, downloads)
  return client
}

function renderCard(i: LibraryItem, client = newClient()) {
  return render(withClient(client,
    <MemoryRouter>
      <TooltipProvider>
        <RevealAllProvider>
          <SelectionProvider>
            <LibraryCard item={i} />
          </SelectionProvider>
        </RevealAllProvider>
      </TooltipProvider>
    </MemoryRouter>),
  )
}

describe("LibraryCard ghost thumbnail", () => {
  it("renders a grayscale image for a ghost with a thumbnail", () => {
    const { container } = renderCard(item({ status: "ghost" }))
    const img = container.querySelector("img")
    expect(img).toHaveClass("grayscale", "hover:grayscale-0")
  })

  it("renders the placeholder with no filter for a ghost without a thumbnail", () => {
    const { container } = renderCard(item({ status: "ghost", thumbnail: null }))
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector(".grayscale")).toBeNull()
  })

  it("leaves a non-ghost thumbnail unfiltered", () => {
    const { container } = renderCard(item({}))
    const img = container.querySelector("img")
    expect(img).not.toBeNull()
    expect(img).not.toHaveClass("grayscale")
  })
})

describe("download progress bar", () => {
  const running = [{ id: 7, status: "downloading", percent: 30 }]

  it("shows on a ghost with an active download, keeping the Ghost badge", () => {
    renderCard(item({ status: "ghost", activeDownloadId: 7 }), newClient(running))
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30")
    expect(screen.getByText("Ghost item")).toBeInTheDocument()
  })

  it("is absent, and requests no downloads, for items without an active download", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("[]")))
    vi.stubGlobal("fetch", fetchMock)
    renderCard(item({ activeDownloadId: null }))
    renderCard(item({ id: 2, status: "ghost", activeDownloadId: null }))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows on the list thumbnail cell only for an active download", async () => {
    const client = newClient(running)
    const { rerender } = render(
      withClient(client, <RevealAllProvider><ThumbCell item={item({ status: "ghost", activeDownloadId: 7 })} /></RevealAllProvider>),
    )
    expect(screen.getByRole("progressbar")).toHaveClass("h-0.5")
    rerender(withClient(client, <RevealAllProvider><ThumbCell item={item({ activeDownloadId: null })} /></RevealAllProvider>))
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull())
  })
})
