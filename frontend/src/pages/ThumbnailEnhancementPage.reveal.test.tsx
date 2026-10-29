import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FloatingActionDock } from "@/components/FloatingActionDock"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { thumbnailEnhancementActiveItemQueryKey } from "@/hooks/useThumbnailEnhancement"
import { hashText } from "@/lib/utils"
import { ThumbnailEnhancementPage } from "@/pages/ThumbnailEnhancementPage"
import { mockFetch } from "@/test/mockApi"

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function entry(id: number, title: string, libraryItemId: number | null, blurred: boolean) {
  return {
    id,
    libraryItemId,
    itemTitle: title,
    status: "success",
    originalWidth: null,
    originalHeight: null,
    enhancedWidth: null,
    enhancedHeight: null,
    originalSizeBytes: null,
    enhancedSizeBytes: null,
    error: null,
    createdAt: "2026-10-29T10:00:00Z",
    hasOriginalBackup: false,
    originalThumbnailPath: null,
    enhancedThumbnailPath: null,
    revertedAt: null,
    triggerType: "manual",
    mode: "upscale",
    blurred,
  }
}

const ENTRIES = [
  entry(1, "Secret One", 11, true),
  entry(2, "Secret Two", 12, true),
  entry(3, "Plain Item", 13, false),
  entry(4, "Gone Item", null, false),
]

const PRIVATE = [{ id: 1, effectiveIsPrivate: true, totalItemCount: 3 }]

type ItemReply = { status: number; body?: unknown }

function serve(opts: { privacy?: boolean; item?: (id: number) => ItemReply } = {}) {
  const privacy = opts.privacy ?? true
  return mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: privacy, thumbnailEnhancementEnabled: true } }
    if (url.endsWith("/collections")) return { status: 200, body: PRIVATE }
    if (url.endsWith("/tags")) return { status: 200, body: [] }
    if (url.includes("/thumbnail-enhancement/history")) return { status: 200, body: { entries: ENTRIES, total: ENTRIES.length } }
    if (url.includes("/thumbnail-enhancement/status")) return { status: 200, body: { configured: false, reachable: false } }
    const m = url.match(/\/library\/(\d+)$/)
    if (m && opts.item) return opts.item(Number(m[1]))
    return { status: 404 }
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <RevealAllProvider>
            <FloatingActionDock>
              <ThumbnailEnhancementPage />
            </FloatingActionDock>
          </RevealAllProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  const setActive = (libraryItemId: number, itemTitle: string) =>
    act(() => {
      client.setQueryData(thumbnailEnhancementActiveItemQueryKey, { libraryItemId, itemTitle, status: "processing" })
    })
  return { client, setActive, ...utils }
}

const revealButton = () => screen.findByRole("button", { name: "Reveal all private items" })
const itemRequests = (fn: ReturnType<typeof mockFetch>) => fn.mock.calls.filter(([url]) => /\/library\/\d+$/.test(url))
const enhancingLine = () => screen.getByText(/^Enhancing:/)

describe("ThumbnailEnhancementPage reveal-all: history rows", () => {
  it("hashes blurred rows as plain, non-clickable text and leaves other rows alone", async () => {
    const user = userEvent.setup()
    serve()
    renderPage()
    const hashed = await screen.findByText(hashText("Secret One"))
    expect(screen.getByText(hashText("Secret Two"))).toBeInTheDocument()
    expect(screen.queryByText("Secret One")).toBeNull()
    expect(hashed.closest("a")).toBeNull()
    expect(hashed).not.toHaveAttribute("title")
    await user.click(hashed)
    expect(screen.getByText(hashText("Secret One"))).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Secret/ })).toBeNull()

    expect(screen.getByRole("link", { name: "Plain Item" })).toHaveAttribute("href", "/library/13")
    expect(screen.getByText("Gone Item").closest("a")).toBeNull()
  })

  it("never puts the real title in a checkbox aria-label while hashed", async () => {
    serve()
    renderPage()
    await screen.findByText(hashText("Secret One"))
    expect(screen.getByRole("checkbox", { name: `Select ${hashText("Secret One")}` })).toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: /Secret One/ })).toBeNull()
    expect(screen.getByRole("checkbox", { name: "Select Plain Item" })).toBeInTheDocument()
  })

  it("reveal-all shows real titles as links; turning it off hashes them again", async () => {
    const user = userEvent.setup()
    serve()
    renderPage()
    await screen.findByText(hashText("Secret One"))
    await user.click(await revealButton())
    expect(screen.getByRole("link", { name: "Secret One" })).toHaveAttribute("href", "/library/11")
    expect(screen.getByRole("link", { name: "Secret Two" })).toHaveAttribute("href", "/library/12")
    expect(screen.getByRole("checkbox", { name: "Select Secret One" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Plain Item" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Hide all private items" }))
    expect(screen.getByText(hashText("Secret One"))).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Secret/ })).toBeNull()
  })

  it("shows real titles and no button when privacy is off", async () => {
    serve({ privacy: false })
    renderPage()
    await screen.findByText("Plain Item")
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("button", { name: /private items/ })).toBeNull()
  })
})

describe("ThumbnailEnhancementPage reveal-all: Enhancing line", () => {
  it("makes no item request while there is no active item", async () => {
    const fn = serve({ item: () => ({ status: 200, body: { id: 11, blurred: false } }) })
    renderPage()
    await screen.findByText(hashText("Secret One"))
    expect(screen.queryByText(/^Enhancing:/)).toBeNull()
    expect(itemRequests(fn)).toHaveLength(0)
  })

  it("stays hashed while the item lookup is pending", async () => {
    const fn = serve({ item: () => ({ status: 200, body: { id: 11, blurred: false } }) })
    // Hold the single-item request open so the lookup stays pending.
    const answer = fn.getMockImplementation()!
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    fn.mockImplementation(async (url, init) => {
      if (/\/library\/\d+$/.test(url)) await gate
      return answer(url, init)
    })
    const { setActive } = renderPage()
    await screen.findByText(hashText("Secret One"))
    setActive(11, "Live Title")
    await waitFor(() => expect(enhancingLine()).toHaveTextContent(`Enhancing: ${hashText("Live Title")}`))
    await waitFor(() => expect(itemRequests(fn).length).toBeGreaterThan(0))
    expect(enhancingLine()).not.toHaveTextContent("Live Title")
    release()
    await waitFor(() => expect(enhancingLine()).toHaveTextContent("Enhancing: Live Title"))
  })

  it("stays hashed when the lookup fails", async () => {
    const fn = serve({ item: () => ({ status: 500 }) })
    const { setActive } = renderPage()
    await screen.findByText(hashText("Secret One"))
    setActive(11, "Live Title")
    await waitFor(() => expect(itemRequests(fn).length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 30))
    expect(enhancingLine()).toHaveTextContent(`Enhancing: ${hashText("Live Title")}`)
  })

  it("is hashed for a blurred item and real for a non-blurred one", async () => {
    serve({ item: (id) => ({ status: 200, body: { id, blurred: id === 11 } }) })
    const { setActive } = renderPage()
    await screen.findByText(hashText("Secret One"))
    setActive(11, "Live Title")
    await waitFor(() => expect(enhancingLine()).toHaveTextContent(hashText("Live Title")))
    await new Promise((r) => setTimeout(r, 30))
    expect(enhancingLine()).toHaveTextContent(hashText("Live Title"))

    setActive(13, "Other Title")
    await waitFor(() => expect(enhancingLine()).toHaveTextContent("Enhancing: Other Title"))
  })

  it("is real under reveal-all and never a link or clickable", async () => {
    const user = userEvent.setup()
    serve({ item: (id) => ({ status: 200, body: { id, blurred: true } }) })
    const { setActive } = renderPage()
    await screen.findByText(hashText("Secret One"))
    setActive(11, "Live Title")
    await waitFor(() => expect(enhancingLine()).toHaveTextContent(hashText("Live Title")))
    await user.click(enhancingLine())
    expect(enhancingLine()).toHaveTextContent(hashText("Live Title"))
    expect(enhancingLine().closest("a")).toBeNull()
    expect(within(enhancingLine()).queryByRole("link")).toBeNull()

    await user.click(await revealButton())
    expect(enhancingLine()).toHaveTextContent("Enhancing: Live Title")
    expect(enhancingLine().closest("a")).toBeNull()
    expect(within(enhancingLine()).queryByRole("link")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Hide all private items" }))
    expect(enhancingLine()).toHaveTextContent(hashText("Live Title"))
  })
})
